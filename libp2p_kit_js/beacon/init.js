import logger from '@mwni/log'
import { createEmitter } from '@mwni/events'
import { initP2P, initPeerStore } from '@tasknet/node'
import { initNet } from './net.js'

export async function startBeacon({ config }){
	let ctx = {
		...createEmitter(),
		type: 'beacon',
		config,
		store: {},
		log: logger.new({
			name: 'beacon',
			color: 'pink',
			root: null,
			severity: config.log.level
		})
	}
	
	ctx.log
		.info(`*** tasknet beacon v0.0.1 ***`)
		.info(`log level is ${config.log.level}`)

	await initPeerStore({ ctx })
	await initP2P({ ctx })
	await initNet({ ctx })

	return ctx
}