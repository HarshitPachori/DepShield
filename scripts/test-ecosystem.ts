import { detectEcosystem, parseDependencies } from '@/backend/service/ecosystem.service';

const TEST_REPO = 'https://github.com/HarshitPachori/ride_fast';

const result = await detectEcosystem(TEST_REPO, 'github');
console.log('Ecosystem:', result);

const deps = await parseDependencies(TEST_REPO, 'github');
console.log('Dependencies:', deps);
