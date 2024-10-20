import { createEmitter } from '@mwni/events'
import { lpStream } from 'it-length-prefixed-stream'


export function initMessageBus(stream){
	let packetStream = lpStream(stream)
	let interceptors = []
	let listeners = []
	let handlers = []
	let requests = []

	function dispatch(type, payload = {}){
		for(let interceptor of interceptors){
			let result = interceptor(type, payload)

			if(!result)
				return;

			([type, payload] = result)
		}

		let matchingListeners = listeners.filter(listener => listener.type === type)

		for(let { callback } of matchingListeners){
			callback(payload, type)
		}

		if(payload.hasOwnProperty('@request')){
			let [requestType, responseType] = type.split('@')
			
			if(!responseType)
				handleIncomingRequest(requestType, payload)
			else
				handleRequestResponse(requestType, responseType, payload)
		}
	}

	async function handleIncomingRequest(type, payload){
		let { handler } = handlers.find(handler => handler.type === type) || {}

		if(handler){
			try{
				let result = await handler({
					...payload,
					emit: (t, p) => send(`${type}@${t}`, p)
				})

				send(`${type}@result`, {
					...result,
					'@request': payload['@request']
				})
			}catch(error){
				send(`${type}@error`, {
					message: `Internal error while handling "${type}" request`,
					detail: error,
					'@request': payload['@request']
				})
			}
		}else{
			send(`${type}@error`, {
				message: `The peer has no handler for "${type}" configured`,
				'@request': payload['@request']
			})
		}
	}

	function handleRequestResponse(requestType, responseType, payload){
		let request = requests.find(({ stamp }) => payload['@request'])

		if(!request){
			dispatch('unexpected_request_response')
			return
		}

		delete payload['@request']

		if(responseType === 'result'){
			request.resolve(payload)
		}else if(responseType === 'error'){
			request.reject(payload)
		}else{
			request.emit(responseType, payload)
		}
	}

	function send(type, payload){
		let message = new TextEncoder().encode(
			JSON.stringify(stripEnodeBuffers({
				'@type': type,
				...payload
			}))
		)

		return packetStream.write(message)
			.catch(() => dispatch('broken_pipe'))
	}

	async function read(){
		while(true){
			try{
				var message = await packetStream.read()
			}catch{
				dispatch('broken_pipe')
				break
			}
			
			try{
				var { '@type': type, ...payload } = mergeDecodeBuffers(
					JSON.parse(
						new TextDecoder().decode(message.subarray())
					)
				)
			}catch{
				dispatch('malformed_message')
				continue
			}

			dispatch(type, payload || {})
		}
	}
 
	Promise.resolve().then(read)
	
	return {
		send,
		intercept(interceptor){
			interceptors.push(interceptor)
		},
		on(type, callback){
			listeners.push({ type, callback })
		},
		handle(type, handler ){
			if(handlers.some(h => h.type === 'type'))
				throw new Error(`A handler for "${type}" has already been set`)

			handlers.push({ type, handler })
		},
		request(type, payload){
			let stamp = generateStamp()
			let resolve
			let reject
			let handle = new Promise(
				(res, rej) => {
					resolve = x => clear() + res(x)
					reject = x => clear() + rej(x)
				}
			)
			let clear = () => requests = requests
				.filter(request => request !== handle)

			send(type, {
				...payload,
				'@request': stamp
			})

			Object.assign(handle, createEmitter())
			Object.assign(handle, {
				type,
				payload,
				stamp,
				resolve,
				reject
			})

			requests.push(handle)

			return handle
		},
		async await(type, timeout){
			return await new Promise(
				(resolve, reject) => {
					let resolveAndClear = payload => clear() + resolve(payload)
					let clear = () => listeners = listeners
						.filter(({ callback }) => callback !== resolveAndClear)

					listeners.push({
						type,
						callback: resolveAndClear
					})

					if(timeout){
						setTimeout(
							() => clear() + reject(
								Object.assign(
									new Error(`Timeout while waiting for "${type}"`), 
									{ timeout: true }
								)
							),
							timeout
						)
					}
				}
			)
		}
	}
}

function stripEnodeBuffers(payload){
	let buffers = []
	let walk = value => {
		if(value instanceof Buffer){
			buffers.push(value.toString('base64'))
			return { '@buffer': buffers.length - 1 }
		}
	
		if(Array.isArray(value))
			return value.map(walk)
		
		if(value && typeof value === 'object')
			return Object.entries(value).reduce(
				(obj, [key, value]) => ({
					...obj,
					[key]: walk(value)
				}),
				{}
			)

		return value
	}

	let strippedPayload = walk(payload)

	if(buffers.length === 0)
		return payload

	return {
		...strippedPayload,
		'@buffers': buffers
	}
}

function mergeDecodeBuffers(payload){
	let { '@buffers': buffers, ...originalPayload } = payload
	let walk = value => {
		if(Array.isArray(value))
			return value.map(walk)
		
		if(value && typeof value === 'object'){
			if(value.hasOwnProperty('@buffer')){
				return Buffer.from(buffers[value['@buffer']], 'base64')
			}

			return Object.entries(value).reduce(
				(obj, [key, value]) => ({
					...obj,
					[key]: walk(value)
				}),
				{}
			)
		}

		return value
	}

	return walk(originalPayload)
}

function generateStamp(){
	return Math.random()
		.toString(32)
		.slice(2, 8)
}