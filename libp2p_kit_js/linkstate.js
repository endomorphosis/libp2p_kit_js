export function applyLinkStateUpdate({ linkstate, update }){
	for(let node of update.nodes){
		let nodeExisting = linkstate.nodes
			.find(({ id }) => id === node.id)

		if(nodeExisting && nodeExisting.lastUpdate >= node.lastUpdate)
			continue

		if(nodeExisting)
			Object.assign(nodeExisting, node)
		else
			linkstate.nodes.push(node)

		linkstate.links = [
			...linkstate.links
				.filter(({ from, to }) => from !== node.id && to !== node.id),
			...update.links
				.filter(({ from, to }) => from === node.id || to === node.id)
		]
	}
}

export function copyPeersToLinkState({ ctx, peers, linkstate }){
	if(!peers)
		peers = ctx.peers

	if(!linkstate)
		linkstate = ctx.linkstate

	linkstate.nodes = [
		...linkstate.nodes
			.filter(peer => peer.id !== ctx.id)
			.filter(peer => peers.every(p => p.id !== peer.id)),
		...peers
			.filter(peer => peer.accepted)
			.map(
				peer => ({
					id: peer.id,
					type: peer.type,
					name: peer.name,
					addresses: peer.addresses,
					lastUpdate: Date.now()
				})
			),
		{
			id: ctx.id,
			type: ctx.type,
			name: ctx.name,
			addresses: ctx.addresses,
			lastUpdate: Date.now()
		}
	]

	linkstate.links = [
		...linkstate.links
			.filter(({ from, to }) => from !== ctx.id && to != ctx.id),
		...peers
			.filter(peer => peer.accepted)
			.map(
				peer => ({
					[peer.connection.direction === 'inbound' ? 'from' : 'to']: peer.id,
					[peer.connection.direction === 'inbound' ? 'to' : 'from']: ctx.id,
					latency: peer.latency
				})
			)
	]
}

export function getLocalLinkState({ ctx, linkstate, forId }){
	let links = linkstate.links
		.filter(({ from, to }) => from === forId || to === forId)

	return {
		nodes: linkstate.nodes.filter(
			({ id }) => id === forId ||
				links.some(({ from, to }) => from === id || to === id)
		),
		links
	}
}