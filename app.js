import express from 'express';
import Ajv from 'ajv';
import etag from 'etag';
import schema from './jsonSchema.js';
import createRedisClient from './createRedisClient.js';
import verifyToken from './verifyToken.js';

const app = express();
const port = 3000;

const ajv = new Ajv();

app.use(express.json());

async function authenticateRequest(req, res, next) {
    try {
        const authHeader = req.headers.authorization;
        if(!authHeader)
        {
            return res.status(401).json({ error: 'No authorization header provided'});
        }

        const token = authHeader.split(' ')[1];
        if(!token)
        {
            return res.status(401).json({ error: 'No token provided'});
        }
        const tokenIsValid = await verifyToken(token);
        if(!tokenIsValid)
        {
            return res.status(403).json({ error: 'Invalid or expired token '});
        }

        next();
    }
    catch(err)
    {
        console.error('Error verifying token:', err);
        res.status(500).json({ error: 'Internal server error'});
    }
}

app.use(authenticateRequest);

app.post('/data', authenticateRequest, async(req, res) => {
    try {
        const valid = ajv.validate(schema, req.body)
        if(!valid)
        {
            return res.status(400).json({ error: ajv.errors })
        }

        const client = await createRedisClient();
        const objectId = req.body.objectId;

        const existingData = await client.get(objectId);
        if(existingData)
        {
            await client.disconnect();
            return res.status(409).json({ error: 'Object with same objectId already exists'});
        }

        await client.set(objectId, JSON.stringify(req.body));


        const responseEtag = etag(JSON.stringify(req.body));
        await client.set(objectId, JSON.stringify(req.body));
        await client.set(`etag:${objectId}`, responseEtag);
        await client.disconnect();
        res.set('Etag', responseEtag);
        res.status(201).json({ id: objectId, data: req.body })
    }
    catch (err) {
        console.error('Error creating data:', err);
        res.status(500).json({error: 'Internal server error'});
    }    
})

app.get('/data/:objectid', authenticateRequest, async (req, res) => {
    try {
        const client = await createRedisClient();
        const objectId = req.params.objectid;

        const data = await client.get(objectId);

        await client.disconnect();

        if(!data)
        {
            return res.status(404).json({ error: 'Data not found'});
        }

        const responseEtag = etag(data);
        res.set('ETag', responseEtag);

        if (req.headers['if-none-match'] === responseEtag) {
            return res.status(304).end();
        }

        res.status(200).json(JSON.parse(data));
    }
    catch(err)
    {
        console.error('Error retrieving data:', err);
        res.status(500).json({error: 'Internal Server Error'});
    }
    })

app.delete('/data/:objectId', authenticateRequest, async (req, res) => {
    try {
        const client = await createRedisClient();
        const objectId = req.params.objectId;
        const clientETag = req.header('If-Match');
        console.log(clientETag);
        if (!clientETag) {
            await client.disconnect();
            return res.status(428).json({ error: 'Precondition Required: If-Match header missing' });
        }

        const currentETag = await client.get(`etag:${objectId}`);
        console.log(currentETag);

        const exists = await client.exists(objectId);
        if(!exists)
        {
            await client.disconnect();
            return res.status(404).json({ error: 'Data not found' });       
        }
        if (currentETag !== clientETag) {
            await client.disconnect();
            return res.status(412).json({ error: 'Precondition Failed: ETag does not match' });
        }

        await client.del(objectId);
        await client.del(`etag:${objectId}`);

        await client.disconnect();

        res.status(200).json({ message: 'Data deleted successfully'});
    }
    catch(err)
    {
        console.error('Error deleting data:', err);
        await client.disconnect();
        res.status(500).json({error: 'Internal Server Error'});
    }
    })

    app.put('/data/:objectId', authenticateRequest, async (req, res) => {
        try {
            const client = await createRedisClient();
            const { objectId } = req.params;
            const newData = req.body;
            const clientETag = req.header('If-Match');
    
            const existingDataString = await client.get(objectId);
            const currentETag = await client.get(`etag:${objectId}`);
    
            if (!existingDataString || currentETag !== clientETag) {
                await client.disconnect();
                return res.status(currentETag ? 412 : 404).json({ error: currentETag ? 'Precondition Failed' : 'Data not found' });
            }
    
            const valid = ajv.validate(schema, newData);
            if (!valid) {
                await client.disconnect();
                return res.status(400).json({ error: ajv.errors });
            }
    
            const newETag = etag(JSON.stringify(newData));
            await client.set(objectId, JSON.stringify(newData));
            await client.set(`etag:${objectId}`, newETag);
            await client.disconnect();
    
            res.set('ETag', newETag);
            res.status(200).json({ message: 'Data replaced successfully', data: newData });
        } catch (err) {
            console.error('Error replacing data:', err);
            res.status(500).json({ error: 'Internal server error' });
        }
    })

app.patch('/data/:objectId', authenticateRequest, async (req, res) => {
    try
    {
        const client = await createRedisClient();
        const { objectId } = req.params;
        const partialUpdate = req.body;
        const clientETag = req.header('If-Match');

        const existingDataString = await client.get(objectId);
        const currentETag = await client.get(`etag:${objectId}`);
        if (!existingDataString || currentETag !== clientETag) {
            await client.disconnect();
            return res.status(currentETag ? 412 : 404).json({ error: currentETag ? 'Precondition Failed' : 'Data not found' });
        }
        const existingData = JSON.parse(existingDataString);

        const updatedData = { ...existingData, ...partialUpdate };

        const valid = ajv.validate(schema, updatedData);
        if(!valid)
        {
            await client.disconnect();
            return res.status(400).json({ error: ajv.errors });
        }
        const updatedETag = etag(JSON.stringify(updatedData));
        await client.set(objectId, JSON.stringify(updatedData));
        await client.set(`etag:${objectId}`, updatedETag);
        await client.disconnect();

        res.set('ETag', updatedETag);
        res.status(200).json({ message: 'Data updated successfully', data: updatedData });
    }
    catch(err)
    {
        console.error('Error updating data:', err);
        res.status(500).json({error: 'Internal server error'});
    }
})


app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });

