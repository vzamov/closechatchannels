require('dotenv').config();

const fs = require('fs');
const client = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

const delaytime = 2000; // Delay time between API executions
const pagesize = 100;   // Amount of channels to get per page (maximum 100)

const sleep = (waitTimeInMs) => new Promise(resolve => setTimeout(resolve, waitTimeInMs));

async function fetchProxySessions() {
    try {
        const allSessions = await client.proxy.v1.services(process.env.TWILIO_PROXY_SERVICE_SID).sessions.list();
        return allSessions.filter(session => session.status !== 'closed');
    } catch (error) {
        console.error('Error fetching proxy sessions:', error);
        return [];
    }
}

async function closeProxySession(sessionSid) {
    const session = await fetchProxySessions(sessionSid);

    if (!session) {
        console.log(`Session ${sessionSid} not found or already closed.`);
        return;
    }

    console.log(`Fetched session ${sessionSid} with status: ${session.status}`);

    try {
        await client.proxy.v1.services(process.env.TWILIO_PROXY_SERVICE_SID)
            .sessions(sessionSid)
            .update({ status: 'closed' });
        console.log(`Proxy session ${sessionSid} closed.`);
    } catch (error) {
        console.error(`Error closing session ${sessionSid}:`, error);
    }
}

async function closeAllOpenProxySessions() {
    try {
        const sessions = await fetchProxySessions();

        for (let session of sessions) {
            await closeProxySession(session.sid);
        }

        console.log('All open proxy sessions closed.');
    } catch (err) {
        console.error('Error closing all open proxy sessions:', err);
    }
}

async function fetchActiveChats() {
    try {
        let activeChats = [];
        let proxySessions = await fetchProxySessions();

        // Start the pagination loop
        let pages = await client.chat.v2.services(process.env.TWILIO_CHAT_INSTANCE).channels.page({ pageSize: pagesize });
        do {
            activeChats = activeChats.concat(
                pages.instances.filter(c => c.attributes.includes('ACTIVE') && c.attributes.includes('INACTIVE')).map(c => c.sid)
            );

            // Check for the next page and wait before fetching
            if (pages.nextPageUrl) {
                await sleep(delaytime);
                pages = await pages.nextPage();
            } else {
                break;
            }
        } while (true);

        const output = {
            activeChats: activeChats,
            proxySessions: proxySessions.map(session => session.sid)
        };

        fs.writeFileSync('Output.txt', JSON.stringify(output, null, 2), 'utf-8');
        console.log('Active chats and proxy sessions fetched and saved to Output.txt');

        // Process the chats after fetching them
        await processChats();
    } catch (err) {
        console.error('Error fetching active chats:', err);
    }
}

async function markChatClosed(chatSid) {
    try {
        const chat = await client.chat.v2.services(process.env.TWILIO_CHAT_INSTANCE).channels(chatSid).fetch();
        
        // Parse the existing attributes
        const chatAttributes = JSON.parse(chat.attributes);
        
        // Modify the status attribute
        chatAttributes.status = "closed";
        
        // If there's a sessionSid, close the proxy session
        if (chatAttributes && chatAttributes.sessionSid) {
            await closeProxySession(chatAttributes.sessionSid);
        }

        // Update the chat channel with the modified attributes
        await client.chat.v2.services(process.env.TWILIO_CHAT_INSTANCE).channels(chatSid).update({
            attributes: JSON.stringify(chatAttributes)
        });
        console.log(`Chat ${chatSid} marked as CLOSED`);
    } catch (err) {
        console.error(`Error marking chat ${chatSid} as CLOSED:`, err);
    }
}


async function processChats() {
    try {
        const data = JSON.parse(fs.readFileSync('Output.txt', 'utf-8'));

        for (let chatSid of data.activeChats) {
            await markChatClosed(chatSid);
        }

        console.log('All chats processed.');
    } catch (err) {
        console.error('Error processing chats:', err);
    }
}

// Start the process
async function start() {
    await fetchActiveChats();
    await closeAllOpenProxySessions();
}

start();
