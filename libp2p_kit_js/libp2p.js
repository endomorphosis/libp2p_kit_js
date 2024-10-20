import { createNetAuth, deriveKeyPair, verifyNetAuth } from './keychain/index.js'
import { createLibp2p } from 'libp2p'
import { createFromPrivKey } from '@libp2p/peer-id-factory'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import { noise } from '@chainsafe/libp2p-noise'
import { multiaddr } from '@multiformats/multiaddr'
import { flushPeerStore, recordPeerEvent } from './store.js'
import { initMessageBus } from './bus.js'


export async function initP2P({ ctx }){
	ctx.peers = []
	ctx.peerHandlers = []
	ctx.messageHistory = []
	ctx.libp2p = await createLibp2p({
		peerId: ctx.config.identityKey
			? await createFromPrivKey(deriveKeyPair(ctx.config.identityKey))
			: undefined,
		addresses: {
			listen: ctx.config.listen
		},
		transports: [
			tcp(),
			webSockets()
		],
		streamMuxers: [
			mplex()
		],
		connectionEncryption: [
			noise()
		]
	})

	ctx.libp2p.addEventListener('peer:connect', event => {
		handleConnection({
			ctx, 
			connection: ctx.libp2p.getConnections(event.detail)[0]
		})
	})

	ctx.libp2p.addEventListener('peer:disconnect', event => {
		ctx.log.debug(`lost connection to ${event.detail}`)

		handleDisconnection({
			ctx, 
			id: event.detail.toString()
		})
	})

	ctx.libp2p.handle('/tasknet/1.0', async ({ connection, stream }) => {
		await handleStream({
			ctx,
			peer: ctx.peers.find(peer => peer.id === connection.remotePeer.toString()),
			stream
		})
	})

	Object.defineProperty(ctx, 'id', {
		get: () => ctx.libp2p.peerId.toString()
	})

	ctx.log.info(`reachable via:`)

	for(let addr of ctx.libp2p.getMultiaddrs()){
		ctx.log.info(`- ${addr}`)
	}
}

export async function registerPeerHandler({ ctx, type, handler }){
	ctx.peerHandlers.push({ type, handler })
}

async function handleConnection({ ctx, connection }){
	let id = connection.remotePeer.toString()
	let peerInfo = ctx.store.peers.find(peer => peer.id === id)
	let peer = {
		id,
		connection
	}

	if(peerInfo){
		Object.assign(peer, peerInfo)
		ctx.log.debug(`new ${connection.direction} connection to ${peer.name || 'known peer'} ${id}`)
	}else{
		ctx.log.debug(`new ${connection.direction} connection to unknown peer ${id}`)
	}

	ctx.peers.push(peer)

	recordPeerEvent({ 
		ctx,
		peer,
		event: 'connect'
	})

	if(shouldInitiateStream({ ctx, theirPeerId: connection.remotePeer })){
		await handleStream({
			ctx,
			peer,
			stream: await connection.newStream([`/tasknet/1.0`]),
		})
	}
}

async function handleStream({ ctx, peer, stream }){
	let isNew = !peer.authenticated

	Object.assign(
		peer,
		initMessageBus(stream)
	)

	try{
		Object.assign(
			peer,
			await performHandshake({ ctx, peer })
		)
		recordPeerEvent({ ctx, peer, event: 'accept' })
	}catch(e){
		recordPeerEvent({ ctx, peer, event: 'reject' })
		ctx.log.debug(`peer ${peer.id} rejected: ${e.message}`)
		peer.connection.abort()
		return
	}finally{
		flushPeerStore({ ctx })
	}

	bindPeerDefaultBehaviors({ ctx, peer })

	await measurePeerLatency({
		ctx,
		peer,
		numMeasurements: 2,
		interval: 250
	})

	if(isNew){
		ctx.log.info(`new ${peer.type}: ${peer.name}`)
	}else{
		ctx.log.info(`reconnected ${peer.type}: ${peer.name}`)
	}

	peer.accepted = true
	ctx.emit('peer:accept', peer)

	let { handler } = ctx.peerHandlers
		.find(({ type }) => type === peer.type) || {}

	if(handler){
		try{
			await handler(peer)
		}catch(error){
			ctx.log.error(`error while handling new ${peer.type}:`, error)
			peer.connection.abort()
			return
		}
	}
}

async function handleDisconnection({ ctx, id }){
	let peer = ctx.peers.find(peer => peer.id === id)

	if(!peer)
		return

	ctx.peers.splice(ctx.peers.indexOf(peer), 1)

	recordPeerEvent({ ctx, peer, event: 'disconnect' })
	flushPeerStore({ ctx })

	if(peer.authenticated){
		ctx.log.info(`lost ${peer.type} ${peer.name}`)
	}else{
		ctx.log.debug(`lost ${peer.type} ${peer.name}`)
	}

	ctx.emit('peer:disconnect', peer)
}

async function performHandshake({ ctx, peer }){
	peer.send('peer:auth', {
		type: ctx.type,
		auth: ctx.netkey
			? createNetAuth({
				nonce: peer.connection.remotePeer.publicKey,
				netkey: ctx.netkey
			})
			: undefined
	})

	let { type, auth } = await peer.await('peer:auth', 7000)
	let info = {
		type,
		authenticated: true
	}

	if(auth){
		let authInfo = verifyNetAuth({
			auth,
			nonce: ctx.libp2p.peerId.publicKey,
			netkey: ctx.netkey
		})

		if(!authInfo)
			throw new Error(`Invalid signature`)

		Object.assign(info, authInfo)
	}else{
		let trust = isTrustedPublicNode({ ctx, peer, type })

		if(!trust)
			throw new Error(`Provided no net-auth and is not a trusted public node`)

		Object.assign(info, {
			public: true,
			...trust
		})
	}

	peer.send('peer:info', {
		name: ctx.config.name,
		addresses: ctx.libp2p.getMultiaddrs()
			.map(addr => addr.toString())
	})

	Object.assign(
		info, 
		await peer.await('peer:info', 3000)
	)

	return info
}

export async function measurePeerLatency({ ctx, peer, numMeasurements = 3, interval = 1000 }){
	recordPeerEvent({ 
		ctx, 
		peer, 
		event: 'measureLatency'
	})

	let measurements = []

	for(let i=0; i<numMeasurements; i++){
		let time = Date.now()
		
		try{
			await peer.request('ping')
		}catch(error){
			ctx.log.warn(`latency measurement with ${peer.name} cancelled: ${error.message}`)
			return
		}

		measurements.push(Date.now() - time)

		await new Promise(resolve => setTimeout(resolve, interval))
	}

	peer.latency = Math.round(measurements.reduce((total, ping) => total + ping, 0) / 6)

	flushPeerStore({ ctx })
	
	ctx.log.debug(`latency measurement with ${peer.name} completed: ${peer.latency} ms`)
}

function isTrustedPublicNode({ ctx, peer, type }){
	if(type === 'beacon'){
		return {
			name: peer.connection.remoteAddr.toString()
				.split('/')
				.at(2)
		}
	}

	return false
}

export async function connect({ ctx, node, address }){
	if(node){
		address = node.addresses

		ctx.log.debug(`connecting to ${node.name}`)

		recordPeerEvent({
			ctx,
			peer: node, 
			event: 'dial'
		})
	}else{
		ctx.log.debug(`dialing ${address}`)
	}

	try{
		await ctx.libp2p.dial(
			Array.isArray(address)
				? address.map(addr => multiaddr(addr))
				: multiaddr(address)
		)
	}catch(error){
		if(node){
			ctx.log.debug(`failed to connect to ${node.name}: ${error.message}`)
		
			recordPeerEvent({
				ctx,
				peer: node,
				event: 'dialError',
				meta: error
			})
		}else{
			throw error
		}
	}
}

function shouldInitiateStream({ ctx, theirPeerId }){
	let myPeerId = ctx.libp2p.peerId
	let [mySize, theirSize] = [myPeerId.publicKey, theirPeerId.publicKey]
		.map(bytes => bytes.subarray(-8))
		.map(bytes => bytes.reduce((x, y) => x * y, 1))

	return mySize > theirSize
}

function bindPeerDefaultBehaviors({ ctx, peer }){
	peer.handle('ping', () => { time: Date.now() })
}