import { createClient } from 'redis';

const redisClient = createClient({
    url: process.env.REDIS_URL,
    connectTimeout: 25000 // 25 seconds
});

redisClient.on('error', err => console.log('Redis Client Error', err));
redisClient.on('connect', err => { if (!err) console.log('Connected to Redis Session Store!'); });

redisClient.connect()
    .then(() => {
        console.log('Connected to Redis!');
        // Perform Redis operations here
    })
    .catch(err => {
        console.error('Failed to connect to Redis:', err);
    });

export default redisClient;