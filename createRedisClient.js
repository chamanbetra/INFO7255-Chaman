import { createClient } from "redis";

async function createRedisClient() {
    const client = createClient({ url: 'redis://localhost:6379' });
    client.on('error', (err) => console.error('Redis Client Error', err));
    await client.connect();
    return client;
}

export default createRedisClient;