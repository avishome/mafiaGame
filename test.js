const WebSocket = require('ws');
const assert = require('assert');

const serverUrl = 'https://mafia-731890553755.us-central1.run.app/'; // Replace with your server URL
const players = [];
const playerCount = 5;
let startMessagesReceived = 0;
let nightMessagesReceived = 0;
let victimChosen = false;

function chooseRandomPlayer(players, currentPlayerId) {
    // Filter out the current player and eliminated players
    const eligiblePlayers = players.filter(player => player.id !== currentPlayerId);
    
    // Randomly select one of the eligible players
    const randomIndex = Math.floor(Math.random() * eligiblePlayers.length);
    return eligiblePlayers[randomIndex];
}

function createPlayer(id, role) {
    const ws = new WebSocket(serverUrl);

    ws.on('open', () => {
        console.log(`Player ${id} connected`);
        ws.send(JSON.stringify({ type: 'join', id: `player${id}` }));
    });

    ws.on('message', (message) => {
        const data = JSON.parse(message);
        console.log(`Player ${id} received:`, data.type);

        if (data.type === 'role') {
            assert(data.role, `Player ${id} should receive a role`);
            if (data.role === 'mafia') {
                role = 'mafia';
            }
        }

        if (data.type === 'start') {
            startMessagesReceived++;
            console.log(`Player ${id} received start message`);
        }

        if (data.type === 'night' && data.message === 'Choose a victim' && role === 'mafia') {
            nightMessagesReceived++;
            console.log(`Mafia player ${id} received night message`);
            if (data.players && data.players.length > 1) {
                // Mafia chooses the first player as the victim
				const victim = chooseRandomPlayer(data.players, `player${id}`);
				console.log(`Mafia player ${id} is choosing victim: ${victim.id}`);
                ws.send(JSON.stringify({ type: 'vote', id: `player${id}`, vote: victim.id }));
                victimChosen = true;
            }
        }
		
		if (data.type === 'day') {
			console.log(`Player ${id} received day message`);
			if (data.players && data.players.length > 0) {
				// Find the first player who is not the current player
                const voteFor = chooseRandomPlayer(data.players, `player${id}`);
				if (voteFor) {
					ws.send(JSON.stringify({ type: 'vote', id: `player${id}`, vote: voteFor.id }));
				}
			}
		}
    });

    ws.on('close', () => {
        console.log(`Player ${id} disconnected`);
    });

    return ws;
}

for (let i = 1; i <= playerCount; i++) {
    players.push(createPlayer(i));
}

// Close connections after some time for demonstration purposes
setTimeout(() => {
    players.forEach((ws, index) => {
        ws.close();
        console.log(`Player ${index + 1} connection closed`);
    });

    // Check if the game started correctly
    assert.strictEqual(startMessagesReceived, playerCount, 'All players should receive the start message');
    assert.strictEqual(nightMessagesReceived, 1, 'Mafia should receive the night message');
    assert(victimChosen, 'Mafia should choose a victim');
    console.log('All tests passed');
}, 30000); // Adjust the timeout as needed