import { getCloudflareContext } from '@opennextjs/cloudflare';
import { getDbInstance } from '.';

export default function getDb() {
	const { env } = getCloudflareContext();
	return getDbInstance(env.DB!);
}
