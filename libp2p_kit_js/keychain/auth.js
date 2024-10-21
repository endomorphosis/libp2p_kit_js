import '@libp2p/crypto/keys'
export * from '@libp2p/crypto/keys'
import { base58btc } from 'multiformats/bases/base58'
import { fromString as uint8arrayFromString } from 'uint8arrays/from-string'
import { toString as uint8arrayToString } from 'uint8arrays/to-string'
import { deriveKeyPair } from './crypto.js'
import { privilegeTiers } from './keys.js'


export function createNetAuth({ nonce, netkey }){
	let message = `${netkey.netId}:${nonce}`
	let signatures = []

	for(let i=0; i<netkey.keychain.length-1; i++){
		signatures.push(
			deriveKeyPair(netkey.keychain[i])
				.sign(uint8arrayFromString(message, 'utf-8'))
		)
	}

	return [
		netkey.netId,
		...signatures
			.map(sig => uint8arrayToString(sig, 'base64'))
	].join(':')
}

export function verifyNetAuth({ nonce, auth, netkey }){
	let [net, ...signatures] = auth.split(':')
	let message = `${net}:${nonce}`
	let privilege = privilegeTiers.at(-signatures.length)

	if(netkey && netkey.netId !== net)
		return false

	let alignedSignatures = signatures.reverse()
	let alignedKeys = netkey
		? netkey.keychain.slice(-signatures.length).reverse()
		: [net]

	for(let i=0; i<alignedKeys.length; i++){
		let valid = new Ed25519PublicKey(base58btc.decode(alignedKeys[i]))
			.verify(
				uint8arrayFromString(message, 'utf-8'),
				uint8arrayFromString(alignedSignatures[i], 'base64')
			)

		if(!valid)
			return false
	}

	return { net, privilege }
}