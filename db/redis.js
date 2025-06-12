import { createClient } from 'redis';

const redisClient = createClient({
    url: process.env.REDIS_URL,
    connectTimeout: 10000 // 10 seconds
});

redisClient.on('error', err => console.log('Redis Client Error', err));

redisClient.connect()
    .then(() => {
        console.log('Connected to Redis!');
        // Perform Redis operations here
    })
    .catch(err => {
        console.error('Failed to connect to Redis:', err);
    });

export default redisClient;