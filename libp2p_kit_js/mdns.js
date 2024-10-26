import multicastDNS from 'multicast-dns'
import { multiaddr } from '@multiformats/multiaddr'
import { isPrivate } from '@libp2p/utils/multiaddr/is-private'
import { knowsPeer, storePeer } from './store.js'


export function initMulticastDNS({ ctx, readOnly }){
	ctx.mdns = {
		ip: '224.0.0.251',
		port: 5353,
		serviceTag: `${ctx.config.net.name}.tasknet.local`,
		readOnly
	}

	ctx.mdns.manager = multicastDNS({
		port: ctx.mdns.port,
		ip: ctx.mdns.ip
	})

	ctx.mdns.manager.on('query', query => handleQuery({ ctx, query }))
	ctx.mdns.manager.on('response', response => handleResponse({ ctx, response }))
	ctx.mdns.manager.on('warning', warning => ctx.log.info(`mdns warning: ${warning.message}`))
	ctx.mdns.manager.on('error', error => ctx.log.warn(`mdns error: ${error.message}`))

	ctx.log.debug(`will query for ${ctx.mdns.serviceTag} PTR records every 10s`)

	setInterval(sendQuery.bind(null, { ctx }),10000)
	sendQuery({ ctx })
}

function sendQuery({ ctx }){
	ctx.mdns.manager.query({
		questions: [{
			name: ctx.mdns.serviceTag,
			type: 'PTR'
		}]
	})
}

async function handleQuery({ ctx, query }){
	if(ctx.mdns.readOnly)
		return

	if(ctx.addresses.length === 0)
		return

	if(!query.questions[0] || query.questions[0].name !== ctx.mdns.serviceTag)
		return

	let answers = []
	let pointerName = `${ctx.name}.${ctx.mdns.serviceTag}`

	answers.push({
		name: ctx.mdns.serviceTag,
		type: 'PTR',
		class: 'IN',
		ttl: 120,
		data: pointerName
	})

	answers.push({
		name: pointerName,
		type: 'TXT',
		class: 'IN',
		ttl: 120,
		data: `id=${ctx.id}`
	})

	answers.push({
		name: pointerName,
		type: 'TXT',
		class: 'IN',
		ttl: 120,
		data: `type=${ctx.type}`
	})

	for(let address of ctx.addresses){
		if(!isPrivate(multiaddr(address)))
			continue

		answers.push({
			name: pointerName,
			type: 'TXT',
			class: 'IN',
			ttl: 120,
			data: `address=${address}`
		})
	}

	ctx.mdns.manager.respond(answers)
}

async function handleResponse({ ctx, response }){
	if(!response.answers)
		return

	let answerPTR = response.answers.find(answer => answer.type === 'PTR')
	let answersTXT = response.answers.filter(answer => answer.type === 'TXT')

	if (answerPTR == null || answerPTR?.name !== ctx.mdns.serviceTag)
		return
	
	if(answersTXT.length === 0 || answerPTR.data.startsWith(ctx.name))
		return

	let answersData = answersTXT
		.flatMap(answer => answer.data)
		.map(data => data.toString())
	
	try{
		var id = answersData
			.find(data => data.startsWith('id='))
			.split('=')[1]

		var type = answersData
			.find(data => data.startsWith('type='))
			.split('=')[1]

		var addresses = answersData
			.filter(data => data.startsWith('address='))
			.map(data => data.split('=')[1])
	}catch(error){
		ctx.log.debug(`got unparsable response:`, response.answers)
	}

	if(id && type && addresses && !knowsPeer({ ctx, peer: { id } })){
		ctx.log.debug(`discovered ${type} ${id}`)
		storePeer({
			ctx,
			peer: { id, type, addresses }
		})
	}
}