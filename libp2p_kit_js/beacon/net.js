import { applyLinkStateUpdate, copyPeersToLinkState, getLocalLinkState } from '@tasknet/node'


export function initNet({ ctx }){
	ctx.linkstates = {}

	ctx.on(
		'peer:accept',
		peer => handleAcceptedPeer({ ctx, peer })
	)

	ctx.on(
		'peer:disconnect',
		peer => handleDisconnectedPeer({ ctx, peer })
	)
}

function handleAcceptedPeer({ ctx, peer }){
	let linkstate = ctx.linkstates[peer.net]

	if(!linkstate)
		ctx.linkstates[peer.net] = linkstate = {
			nodes: [],
			links: [],
			seenBroadcasts: []
		}

	broadcastLocalLinkStateUpdate({
		ctx, 
		net: peer.net
	})

	peer.on(
		'linkstate:update', 
		update => handleLinkStateUpdate({
			ctx,
			from: peer,
			...update
		})
	)

	peer.send('linkstate:update', {
		linkstate: {
			nodes: linkstate.nodes,
			links: linkstate.links
		}
	})
}

function handleDisconnectedPeer({ ctx, peer }){
	let linkstate = ctx.linkstates[peer.net]

	linkstate.links = linkstate.links
		.filter(({ from, to }) => from !== peer.id && to !== peer.id)

	broadcastLocalLinkStateUpdate({
		ctx,
		net: peer.net
	})
}

function handleLinkStateUpdate({ ctx, from, linkstate: update, broadcast, stamp }){
	let linkstate = ctx.linkstates[from.net]
	
	if(broadcast){
		if(linkstate.seenBroadcasts.includes(stamp))
			return

		broadcastLinkState({
			ctx,
			linkstate: update,
			stamp
		})

		linkstate.seenBroadcasts = [
			stamp, 
			...linkstate.seenBroadcasts
		].slice(0, 100)
	}

	applyLinkStateUpdate({
		linkstate,
		update
	})
}

function broadcastLocalLinkStateUpdate({ ctx, net }){
	let linkstate = ctx.linkstates[net]

	copyPeersToLinkState({
		ctx,
		linkstate,
		peers: ctx.peers
			.filter(peer => peer.net === net)
	})

	let local = getLocalLinkState({
		linkstate: linkstate,
		forId: ctx.id
	})

	let stamp = Math.random()
		.toString(32)
		.slice(2, 10)

	broadcastLinkState({
		ctx,
		linkstate: local,
		stamp
	})
	
	linkstate.seenBroadcasts.push(stamp)

	ctx.log.debug(
		`broadcasted local linkstate (` + 
		(local.nodes.length === 1 ? '1 node ' : `${local.nodes.length} nodes `) +
		(local.links.length === 1 ? '1 link)' : `${local.links.length} links)`)
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