/* import { OAuth2Client } from "google-auth-library";

const CLIENT_ID = '352041082910-3jk4qdpf8orcrsrvdrfu7p67a011hr5p.apps.googleusercontent.com';

const client = new OAuth2Client(CLIENT_ID);

export default async function verifyToken(token)
{
    const ticket = await client.verifyIdToken({
        idToken: token,
        audience: CLIENT_ID,
    });
    const payload = ticket.getPayload();
    return payload;
}
 */

import fetch from "node-fetch";

export default async function verifyToken(token)
{
    const url = `https://oauth2.googleapis.com/tokeninfo?access_token=${token}`;
    try 
    {
       const response = await fetch(url);
       return response.ok;
    }
    catch(e)
    {
        console.log(`error while verifying token: ${e}`);
        return false;
    }
}