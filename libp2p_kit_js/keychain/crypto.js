import crypto from 'crypto'
// import { generateKeyPair, generateKeyPairFromSeed, Ed25519PrivateKey } from '@libp2p/crypto/keys'
import { generateKeyPair, generateKeyPairFromSeed, Ed25519PrivateKey } from 'libp2p-crypto'
import { base58btc } from 'multiformats/bases/base58'
import { concat as uint8arrayConcat } from 'uint8arrays/concat'
import { fromString as uint8arrayFromString } from 'uint8arrays/from-string'
import { toString as uint8arrayToString } from 'uint8arrays/to-string'


export async function generateKey(seed){
	let keypair = !seed
		? await generateKeyPair('ed25519')
		: await generateKeyPairFromSeed(
			'ed25519', 
			crypto.createHash('sha512')
				.update(seed)
				.digest()
				.subarray(0, 32)
		)

	return base58btc.encode(keypair.marshal().slice(0, 32))
}

export function deriveKeyPair(key){
	let privateKey = typeof key === 'string'
		? base58btc.decode(key)
		: key
	let publicKey = derivePublicKey(privateKey)

	return new Ed25519PrivateKey(
		uint8arrayConcat([privateKey, publicKey], privateKey.byteLength + publicKey.byteLength),
		publicKey
	)
}

export function derivePublicKey(key) {
	const keyObject = crypto.createPrivateKey({
		format: 'jwk',
		key: {
		crv: 'Ed25519',
		x: '',
		d: uint8arrayToString(
			typeof key === 'string' ? base58btc.decode(key) : key, 
			'base64url'
		),
		kty: 'OKP'
		}
	})
	
	const jwk = keyObject.export({
		format: 'jwk'
	})

	const publicKey = uint8arrayFromString(jwk.x, 'base64url')

	return typeof key === 'string'
		? base58btc.encode(publicKey)
		: publicKey
}
