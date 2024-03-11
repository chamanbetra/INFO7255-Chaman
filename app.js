import express from 'express';
import bodyParser from 'body-parser';
import Ajv from 'ajv';
import etag from 'etag';
import schema from './jsonSchema.js';
import createRedisClient from './createRedisClient.js';

const app = express();
const port = 3000;

const ajv = new Ajv();

app.use(bodyParser.json());

app.post('/data', async(req, res) => {
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

        await client.disconnect();

        const responseEtag = etag(JSON.stringify(req.body));
        res.set('Etag', responseEtag);
        res.status(201).json({ id: objectId, data: req.body })
    }
    catch (err) {
        console.error('Error creating data:', err);
        res.status(500).json({error: 'Internal server error'});
    }    
})

app.get('/data/:objectid', async (req, res) => {
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

app.delete('/data/:objectId', async (req, res) => {
    try {
        const client = await createRedisClient();
        const objectId = req.params.objectId;

        const exists = await client.exists(objectId);

        if(!exists)
        {
            await client.disconnect();
            return res.status(404).json({ error: 'Data not found'});
        }

        await client.del(objectId);

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


    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
    });

