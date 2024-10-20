import { knowsPeer, storePeer, whenLastPeerEvent } from './store.js'
import { connect, measurePeerLatency } from './p2p.js'
import { applyLinkStateUpdate, copyPeersToLinkState, getLocalLinkState } from './linkstate.js'


export function initPeering({ ctx }){
	ctx.linkstate = {
		nodes: [],
		links: [],
		seenBroadcasts: []
	}

	ctx.on(
		'peer:accept',
		peer => handleAcceptedPeer({ ctx, peer })
	)

	ctx.on(
		'peer:disconnect',
		peer => handleDisconnectedPeer({ ctx, peer })
	)

	runPeeringLoop({ ctx })
		.catch(error => ctx.log.error(`peering loop crashed:`, error))
}

function handleAcceptedPeer({ ctx, peer: newPeer }){
	copyPeersToLinkState({ ctx })

	newPeer.send('linkstate:update', {
		linkstate: {
			nodes: ctx.linkstate.nodes,
			links: ctx.linkstate.links
		}
	})

	newPeer.on(
		'linkstate:update', 
		update => handleLinkStateUpdate({
			ctx,
			from: newPeer,
			...update
		})
	)
}

function handleDisconnectedPeer({ ctx, peer }){
	ctx.linkstate.links = ctx.linkstate.links
		.filter(({ from, to }) => from !== peer.id && to !== peer.id)

	copyPeersToLinkState({ ctx })
	broadcastMyLocalLinkState({ ctx })
}

function handleLinkStateUpdate({ ctx, from, linkstate, broadcast, stamp }){
	if(broadcast){
		if(ctx.linkstate.seenBroadcasts.includes(stamp))
			return

		broadcastLinkState({
			ctx,
			linkstate,
			stamp
		})

		ctx.linkstate.seenBroadcasts = [
			stamp, 
			...ctx.linkstate.seenBroadcasts
		].slice(0, 100)
	}

	applyLinkStateUpdate({
		linkstate: ctx.linkstate,
		update: linkstate
	})

	for(let node of linkstate.nodes){
		let isPeer = ctx.peers
			.some(({ id }) => id === node.id)

		if(!isPeer && knowsPeer({ ctx, peer: node })){
			storePeer({
				ctx,
				peer: node,
				update: prev => ({
					...prev,
					...node,
					lastUpdate: Math.max(node.lastUpdate, prev?.lastUpdate || 0)
				})
			})
		}
	}
}

function broadcastMyLocalLinkState({ ctx }){
	let linkstate = getLocalLinkState({
		linkstate: ctx.linkstate,
		forId: ctx.id
	})

	let stamp = Math.random()
		.toString(32)
		.slice(2, 10)

	broadcastLinkState({
		ctx,
		linkstate,
		stamp
	})

	ctx.linkstate.seenBroadcasts.push(stamp)
	ctx.linkstate.broadcasted = linkstate
	ctx.log.debug(
		`broadcasted local linkstate (` + 
		(linkstate.nodes.length === 1 ? '1 node ' : `${linkstate.nodes.length} nodes `) +
		(linkstate.links.length === 1 ? '1 link)' : `${linkstate.links.length} links)`)
	)
}

function broadcastLinkState({ ctx, linkstate, stamp }){
	ctx.peers
		.filter(peer => peer.accepted)
		.filter(peer => peer.type !== 'client')
		.forEach(peer => peer.send('linkstate:update', {
			linkstate,
			broadcast: true,
			stamp
		}))
}

function shouldBroadcastMyLocalLinkState({ ctx }){
	let previous = ctx.linkstate.broadcasted
	let current = getLocalLinkState({
		linkstate: ctx.linkstate,
		forId: ctx.id
	})

	if(current.nodes.length <= 1 || current.links.length === 0)
		return false

	if(!previous)
		return true

	if(current.nodes.length !== previous.nodes.length)
		return true

	if(current.nodes.some(node => previous.nodes.every(({ id }) => id !== node.id)))
		return true

	if(current.links.length !== previous.links.length)
		return true

	for(let link of current.links){
		let linkPrevious = previous.links.find(
			({ from, to }) => from === link.from && to === link.to
		)

		if(!linkPrevious)
			return true

		let latencyDelta = Math.abs(link.latency - linkPrevious.latency)
		let latencyDeltaRatio = latencyDelta / Math.max(link.latency, 0.1)
		
		if(latencyDelta > 5 && (latencyDelta > 15 || latencyDeltaRatio > 0.1))
			return true
	}

	return false
}

async function runPeeringLoop({ ctx }){
	while(true){
		await new Promise(resolve => setTimeout(resolve, 250))

		updatePeerLatencies({ ctx })
		balancePeers({ ctx })
		copyPeersToLinkState({ ctx })

		if(shouldBroadcastMyLocalLinkState({ ctx }))
			broadcastMyLocalLinkState({ ctx })
	}
}

function updatePeerLatencies({ ctx }){
	for(let peer of ctx.peers){
		if(!peer.accepted)
			continue

		let lastConnectAgo = whenLastPeerEvent({
			ctx,
			peer, 
			event: 'connect'
		})

		if(lastConnectAgo < 500)
			continue

		let lastLatencyMeasurementAgo = whenLastPeerEvent({
			ctx,
			peer, 
			event: 'measureLatency'
		})

		if(!lastLatencyMeasurementAgo || lastLatencyMeasurementAgo > 10000){
			measurePeerLatency({ ctx, peer })
		}
	}
}

function balancePeers({ ctx }){
	let pendingPeersCount = ctx.peers.reduce((count, peer) => count + !peer.accepted, 0)
	let acceptedPeersCount = ctx.peers.reduce((count, peer) => count + !!peer.accepted, 0)
	let optimalPeersCount = (ctx.config.peering.minPeers + ctx.config.peering.maxPeers) / 2
	let filterPeerByAtLeastAgo = (event, ago) => 
		peer => (whenLastPeerEvent({ ctx, peer, event }) || Infinity) > ago

	if(acceptedPeersCount + pendingPeersCount < optimalPeersCount){
		let bestNodeToConnect = [...ctx.store.peers, ...ctx.linkstate.nodes]
			.filter(node => node.id !== ctx.id)
			.filter(node => ctx.peers.every(peer => peer.id !== node.id))
			.filter(filterPeerByAtLeastAgo('dial', 10000))
			.filter(filterPeerByAtLeastAgo('dialError', 60000))
			.filter(filterPeerByAtLeastAgo('disconnect', 30000))
			.map(node => ({ node, score: scorePotentialPeer({ ctx, node }) }))
			.sort((a, b) => b.score - a.score)
			.at(0)?.node

		if(bestNodeToConnect){
			connect({
				ctx,
				node: bestNodeToConnect
			})
		}
	}else{
		// todo
	}
}

function scorePotentialPeer({ ctx, node }){
	let score = 100

	score -= node.latency || 100
	score -= (Date.now() - node.lastUpdate) / (1000 * 60 * 10) * 10

	return score
}