import { createLibp2p } from 'libp2p'
import { createFromPrivKey } from '@libp2p/peer-id-factory'
import { tcp } from '@libp2p/tcp'
import { webSockets } from '@libp2p/websockets'
import { mplex } from '@libp2p/mplex'
import { noise } from '@chainsafe/libp2p-noise'
import { createNetAuth, deriveKeyPair, verifyNetAuth } from '@tasknet/keychain'
import { multiaddr } from '@multiformats/multiaddr'
import { flushPeers, recordPeerEvent } from './cache.js'
import { initMessageBus } from './bus.js'


export async function initP2P({ ctx }){
	ctx.peers = []
	ctx.handlers = []
	ctx.libp2p = await createLibp2p({
		peerId: ctx.config.node.identityKey
			? await createFromPrivKey(deriveKeyPair(ctx.config.node.identityKey))
			: undefined,
		addresses: {
			listen: ctx.config.node.listen
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
		ctx.log.debug(`new connection to ${event.detail}`)

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

	ctx.libp2p.handle('/tasknet/peer/1.0', async ({ connection, stream }) => {
		await handleStream({
			ctx,
			connection,
			stream
		})
	})

	Object.defineProperty(ctx, 'id', {
		get: () => ctx.libp2p.peerId.toString()
	})
}

export async function registerPeerHandler({ ctx, type, handler }){
	ctx.handlers.push({ type, handler })
}

async function handleConnection({ ctx, connection }){
	if(shouldInitiateStream({ ctx, theirPeerId: connection.remotePeer })){
		await handleStream({
			ctx,
			connection,
			stream: await connection.newStream([`/tasknet/peer/1.0`]),
		})
	}
}

async function handleStream({ ctx, connection, stream }){
	let id = connection.remotePeer.toString()
	let peer = ctx.cache.peers.find(peer => peer.id === id)

	if(peer?.connected){
		ctx.log.warn(`${peer.type} ${peer.name} already connected`)
		return
	}

	peer = {
		...initMessageBus(stream),
		id,
		connection,
		peers: [{ id: ctx.id }],
		journal: []
	}

	try{
		Object.assign(
			peer,
			await performHandshake({ ctx, peer })
		)
	}catch(e){
		ctx.log.debug(`peer ${peer.id} rejected: ${e.message}`)
		connection.abort()
		return
	}

	bindPeerDefaultBehaviors({ ctx, peer })

	if(peer.public)
		ctx.log.debug(`public ${peer.type} said hello without signature`)
	else
		ctx.log.debug(`${peer.type} ${peer.name} (${peer.id}) said hello with valid net signature`)

	ctx.log.info(`new ${peer.type}: ${peer.name}`)

	ctx.peers.push(peer)
	
	recordPeerEvent({ ctx, peer, event: 'connect' })
	flushPeers({ ctx })

	let { handler } = ctx.handlers
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
	
	ctx.emit('peer:new', peer)
}

async function handleDisconnection({ ctx, id }){
	let peer = ctx.peers.find(peer => peer.id === id)

	if(!peer)
		return

	ctx.log.info(`lost ${peer.type} ${peer.name}`)
	ctx.peers.splice(ctx.peers.indexOf(peer), 1)

	recordPeerEvent({ ctx, peer, event: 'disconnect' })
	flushPeers({ ctx })

	ctx.emit('peer:lost', peer)
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
	let info = { type }

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
		name: ctx.config.node.name,
		addresses: ctx.libp2p.getMultiaddrs()
			.map(addr => addr.toString())
	})

	Object.assign(
		info, 
		await peer.await('peer:info', 3000)
	)

	return info
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

export async function connect({ ctx, address }){
	ctx.log.debug(`dialing ${address}`)

	await ctx.libp2p.dial(
		Array.isArray(address)
			? address.map(addr => multiaddr(addr))
			: multiaddr(address)
	)
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