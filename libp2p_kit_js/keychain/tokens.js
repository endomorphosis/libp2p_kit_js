import { base58btc } from 'multiformats/bases/base58'
import { derivePublicKey } from './crypto.js'
import { privilegeTiers } from './keys.js'


export function createAccessToken({ netkey, privilege, config }){
	let { name, beacon } = config

	if(!name)
		throw new Error(`Need name to create access token`)

	if(!privilegeTiers.includes(privilege))
		throw new Error(`Invalid requested privilege "${privilege}"`)

	let keyTier = privilegeTiers.indexOf(netkey.privilege)
	let targetTier = privilegeTiers.indexOf(privilege)

	if(targetTier < keyTier)
		throw new Error(
			`Cannot create access token with privilege "${privilege}" ` +
			`because the passed netkey only has privilege "${netkey.privilege}"`
		)

	let buffer = Buffer.concat([
		base58btc.decode(netkey.keychain.at(targetTier - keyTier)),
		new TextEncoder().encode(
			JSON.stringify({
				beacon
			})
		)
	])

	return `${name}_${privilege}_${base58btc.encode(buffer)}`
}

export function parseAccessToken(token){
	let segments = token.split('_')
	let name = segments.slice(0, -2).join('_')
	let privilege = segments.at(-2)
	let buffer = base58btc.decode(segments[segments.length - 1])
	let key = base58btc.encode(buffer.slice(0, 32))
	let data = JSON.parse(new TextDecoder().decode(buffer.slice(32)))

	if(!privilegeTiers.includes(privilege))
		throw new Error(`Passed access token has invalid privilege`)

	return {
		name,
		key: `${privilege}:${key}`,
		...data
	}
}