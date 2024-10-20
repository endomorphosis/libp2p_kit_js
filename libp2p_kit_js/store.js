export async function initPeerStore({ ctx }){
	ctx.store.peers = []
}

export async function storePeer({ ctx, peer, update }){
	let existing = ctx.store.peers.find(p => p.id === peer.id)

	if(existing){
		Object.assign(existing, update ? update(existing) : peer)
	}else{
		ctx.store.peers.push(update ? update() : peer)
	}

	flushPeerStore({ ctx })
}

export async function flushPeerStore({ ctx }){
	let connectedPeers = ctx.peers
	let knownPeers = ctx.store.peers
		.filter(p => !p.connected)
	let lostPeers = ctx.store.peers
		.filter(p => p.connected)
		.filter(p => !connectedPeers.some(op => op.id === p.id))

	ctx.store.peers = makeUniquePeerList([
		...knownPeers,
		...lostPeers.map(
			peer => ({
				...peer,
				connected: false
			})
		),
		...connectedPeers.map(
			peer => ({
				id: peer.id,
				name: peer.name,
				type: peer.type,
				addresses: peer.addresses,
				latency: peer.latency,
				journal: peer.journal,
				connected: true,
				lastUpdate: Date.now(),
			})
		),
	])
}

export function knowsPeer({ ctx, peer }){
	return ctx.store.peers.some(p => p.id === peer.id)
}

export function recordPeerEvent({ ctx, peer, event, meta }){
	if(!knowsPeer({ ctx, peer }))
		ctx.store.peers.push(peer)

	getPeerJournal({ ctx, peer })
		.push({
			event, 
			meta, 
			time: Date.now()
		})

	flushPeerStore({ ctx })
}

export function whenLastPeerEvent({ ctx, peer, event }){
	let journal = getPeerJournal({ ctx, peer })
	let entry = journal?.findLast(entry => entry.event === event)

	return entry
		? Date.now() - entry.time
		: undefined
}

function getPeerJournal({ ctx, peer }){
	if(peer.journal)
		return peer.journal

	peer = ctx.store.peers.find(p => p.id === peer.id)

	if(!peer)
		return null

	if(!peer.journal)
		peer.journal = [] 

	return peer.journal
}

function makeUniquePeerList(list){
	let map = {}

	for(let peer of list){
		map[peer.id] = peer
	}
	
	return Object.values(map)
}