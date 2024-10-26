import { createNetAuth, deriveKeyPair, verifyNetAuth } from './keychain/index.js'
import { createLibp2p } from 'libp2p'
import { createFromPrivKey } from '@libp2p/peer-id-factory'
import { tcp } from '@libp2p/tcp'
import { mplex } from '@libp2p/mplex'
import { noise } from '@chainsafe/libp2p-noise'
import { multiaddr } from '@multiformats/multiaddr'
import { initMessageBus } from './bus.js'
import { bindStringToMultiaddrs } from './utils.js'
import { webSockets } from '@libp2p/websockets'
import { yamux } from '@chainsafe/libp2p-yamux'
import { flushPeerStore, recordPeerEvent, whenLastPeerEvent } from './store.js'
import { initMulticastDNS } from './mdns.js'


export class libp2pKit {
	constructor(resources, metadata) {
		this.resources = resources;
		this.metadata = metadata;
		this.ctx = {
			config: {
				identityKey: null,
				listen: null
			},
			peers: [],
			peerHandlers: [],
			messageHistory: [],
			libp2p: null
		}
	}

	async initP2P({ ctx }){
		ctx.peers = []
		ctx.peerHandlers = []
		ctx.messageHistory = []
		ctx.libp2p = await createLibp2p({
			privateKey: ctx.config.identityKey
				? deriveKeyPair(ctx.config.identityKey)
				: undefined,
			addresses: {
				listen: ctx.config.bind
					? bindStringToMultiaddrs({
						bind: ctx.config.bind,
						protocol: ctx.type === 'beacon' ? 'ws' : 'tcp'
					})
					: undefined
			},
			transports: [
				tcp(),
				webSockets()
			],
			streamMuxers: [
				yamux()
			],
			connectionEncrypters: [
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
				connection,
				stream
			})
		})

		Object.defineProperty(ctx, 'id', {
			get: () => ctx.libp2p.peerId.toString()
		})

		if(ctx.config.bind){
			ctx.log.info(`reachable via:`)

			for(let addr of ctx.libp2p.getMultiaddrs()){
				ctx.log.info(`- ${addr}`)
			}
		}

		if(ctx.config.net?.beacon){
			ctx.log.info(`connecting to beacon ${ctx.config.net.beacon}`)
			connectBeacon({
				ctx,
				address: ctx.config.net.beacon
			})
		}

		if(ctx.config.net?.mdns){
			ctx.log.info(`using mDNS for local peer discovery`)
			initMulticastDNS({
				ctx,
				readOnly: ctx.type === 'client'
			})
		}
	}

	async registerPeerHandler({ ctx, type, handler }){
		ctx.peerHandlers.push({ type, handler })
	}

	async handleConnection({ ctx, connection }){
		let id = connection.remotePeer.toString()
		let peerInfo = ctx.store.peers.find(peer => peer.id === id)

		if(peerInfo){
			ctx.log.debug(`new ${connection.direction} connection to ${peerInfo.name || 'known peer'} ${id}`)
		}else{
			ctx.log.debug(`new ${connection.direction} connection to unknown peer ${id}`)
		}

		if(connection.direction === 'outbound'){
			await handleStream({
				ctx,
				connection,
				stream: await connection.newStream([`/tasknet/1.0`]),
			})
		}
	}

	async handleStream({ ctx, connection, stream }){
		let id = connection.remotePeer.toString()
		let peerInfo = ctx.store.peers.find(peer => peer.id === id)
		let peer = { id, connection, ...peerInfo }
		let isNew = whenLastPeerEvent({ ctx, peer, event: 'accept' }) === undefined

		Object.assign(
			peer,
			initMessageBus(stream)
		)

		try{
			Object.assign(
				peer,
				await performHandshake({ ctx, peer })
			)

			ctx.peers.push(peer)

			recordPeerEvent({ ctx, peer, event: 'accept' })
			bindPeerDefaultBehaviors({ ctx, peer })

			await measurePeerLatency({
				ctx,
				peer,
				numMeasurements: 2,
				interval: 250
			})
		}catch(e){
			recordPeerEvent({ ctx, peer, event: 'reject' })
			ctx.log.debug(`peer ${peer.id} rejected: ${e.message}`)
			peer.connection.abort()
			return
		}finally{
			flushPeerStore({ ctx })
		}

		if(isNew){
			ctx.log.info(`new ${peer.type}: ${peer.name}`)
		}else{
			ctx.log.info(`reconnected ${peer.type}: ${peer.name}`)
		}
		
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

	async handleDisconnection({ ctx, id }){
		let peer = ctx.peers.find(peer => peer.id === id)

		if(!peer){
			ctx.log.debug(`lost connection to unidentified peer ${id}`)
			return
		}

		ctx.peers.splice(ctx.peers.indexOf(peer), 1)
		ctx.log.info(`lost ${peer.type} ${peer.name}`)

		recordPeerEvent({ ctx, peer, event: 'disconnect' })
		flushPeerStore({ ctx })

		ctx.emit('peer:disconnect', peer)
	}

	async performHandshake({ ctx, peer }){
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

			if(authInfo.privilege === 'client' && info.type !== 'client')
				throw new Error(`Forbidden peer type`)

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

	bindPeerDefaultBehaviors({ ctx, peer }){
		peer.handle('ping', () => { time: Date.now() })
	}

	async measurePeerLatency({ ctx, peer, numMeasurements = 3, interval = 1000 }){
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

	async connectBeacon({ ctx, address }){
		while(true){
			try{
				return await connect({
					ctx,
					address: bindStringToMultiaddrs({
						bind: address,
						protocol: 'ws',
						defaultPort: 40001
					})
				})
			}catch(error){
				ctx.log.warn(`beacon unreachable: ${error.message}`)
				await new Promise(resolve => setTimeout(resolve, 10000))
			}
		}
	}

	async connect({ ctx, node, address }){
		if(node){
			address = node.addresses

			ctx.log.debug(`connecting to ${node.name || node.id}`)

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

	getPendingConnectionsCount({ ctx }){
		return ctx.libp2p.getDialQueue().length + ctx.libp2p.getConnections()
			.filter(connection => ctx.peers.every(peer => peer.connection !== connection))
			.length
	}

	isTrustedPublicNode({ ctx, peer, type }){
		if(type === 'beacon'){
			return {
				name: peer.connection.remoteAddr.toString()
					.split('/')
					.at(2)
			}
		}

		return false
	}
}