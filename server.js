const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let currentPhase = 'night'; // 'day' or 'night'
let players = [];
let roles = [];
let announcer = null; // To store the announcer's websocket

const MAFIA_COUNT = 1; // You can adjust the number of mafia players here


wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        switch (data.type) {
            case 'join':
                if (!announcer) {
                    // The first user becomes the announcer
                    announcer = { ws };
                    ws.send(JSON.stringify({ type: 'announcer', message: 'You are the announcer.' }));
                } else {
                    // Add new player to the players array
                    players.push({ id: data.id, ws, status: 'alive', vote: null });
                    // Notify the announcer about the new player
                    notifyAnnouncer({ type: 'playerJoined', playerId: data.id });
                    /*if (players.length === 10) { // Start game with 10 players
                        assignRoles();
                        startGame();
                    }*/
                }
                break;
            case 'vote':
                handleVote(data);
                break;
			case 'start':
                assignRoles();
                startGame();
                break;
            // Add more cases as needed
        }
    });

    ws.on('close', () => {
        if (announcer && ws === announcer.ws) {
            // Announcer disconnected
            announcer = null;
            console.log('Announcer disconnected');
        } else {
            // Remove player from the players array
            const player = players.find(player => player.ws === ws);
            if (player) {
                players = players.filter(p => p.ws !== ws);
                // Notify the announcer about the player leaving
                notifyAnnouncer({ type: 'playerLeft', playerId: player.id });
            }
        }
    });
});

// Function to send updates to the announcer
function notifyAnnouncer(data) {
    if (announcer && announcer.ws.readyState === WebSocket.OPEN) {
        announcer.ws.send(JSON.stringify(data));
    }
}

function assignRoles() {
    // Create roles array based on total players and mafia count
    const roles = [
        ...Array(MAFIA_COUNT).fill('mafia'),
        ...Array(players.length - MAFIA_COUNT).fill('villager')
    ];
    
    // Shuffle roles
    roles.sort(() => Math.random() - 0.5);
    players.forEach((player, index) => {
        player.role = roles[index];
        player.ws.send(JSON.stringify({ type: 'role', role: player.role }));
        // Notify the announcer about the assigned roles (optional)
        notifyAnnouncer({ type: 'roleAssigned', playerId: player.id, role: player.role });
    });
}

function startGame() {
    // Notify all players that the game is starting
    players.forEach(player => {
        player.ws.send(JSON.stringify({ type: 'start', message: 'The game has started!' }));
    });

    // Notify the announcer that the game has started
    notifyAnnouncer({ type: 'gameStarted', message: 'The game has started!' });

    // Start the night phase
    startNightPhase();
}

function startNightPhase() {
    currentPhase = 'night';
    // Reset votes
    players.forEach(player => {
        player.vote = null;
    });

    // Notify alive mafia to choose a victim
    players.filter(player => player.role === 'mafia' && player.status === 'alive').forEach(mafia => {
        mafia.ws.send(JSON.stringify({
            type: 'night',
            message: 'Choose a victim',
            players: players.filter(p => p.status === 'alive' && p.id !== mafia.id).map(p => ({ id: p.id }))
        }));
    });

    // Notify the announcer about the night phase start
    notifyAnnouncer({
        type: 'nightPhaseStarted',
        message: 'Night phase has started.',
        alivePlayers: players.filter(p => p.status === 'alive').map(p => ({ id: p.id, role: p.role }))
    });
}

function startDayPhase(nightVictimId) {
    currentPhase = 'day';
    // Reset votes
    players.forEach(player => {
        player.vote = null;
    });

    if (nightVictimId) {
        const victim = players.find(player => player.id === nightVictimId);
        if (victim) {
            victim.status = 'eliminated';
            victim.ws.send(JSON.stringify({ type: 'eliminated', message: 'You have been eliminated during the night!' }));
            // Notify the announcer about the elimination
            notifyAnnouncer({
                type: 'playerEliminated',
                playerId: victim.id,
                phase: 'night'
            });
        }
    }

    // Notify all players about the night result
    players.forEach(player => {
        player.ws.send(JSON.stringify({ type: 'nightResult', message: `Player ${nightVictimId || 'none'} was eliminated during the night.` }));
    });

    // Notify the announcer about the night result
    notifyAnnouncer({
        type: 'nightResult',
        message: `Player ${nightVictimId || 'none'} was eliminated during the night.`,
        alivePlayers: players.filter(p => p.status === 'alive').map(p => ({ id: p.id }))
    });

    // Check for win conditions
    if (checkWinConditions()) {
        return;
    }

    // Notify alive players that it's day time
    players.filter(player => player.status === 'alive').forEach(player => {
        player.ws.send(JSON.stringify({
            type: 'day',
            message: 'It is now day time. Discuss and vote!',
            players: players.filter(p => p.id !== player.id && p.status === 'alive').map(p => ({ id: p.id }))
        }));
    });

    // Notify the announcer about the day phase start
    notifyAnnouncer({
        type: 'dayPhaseStarted',
        message: 'Day phase has started.',
        alivePlayers: players.filter(p => p.status === 'alive').map(p => ({ id: p.id }))
    });
}

function handleVote(data) {
    const votingPlayer = players.find(player => player.id === data.id && player.status === 'alive');
    if (votingPlayer) {
        votingPlayer.vote = data.vote;

        // Notify the announcer about the vote
        notifyAnnouncer({
            type: 'playerVoted',
            playerId: votingPlayer.id,
            vote: data.vote,
            phase: currentPhase
        });
    }

    const expectedVoters = players.filter(player => {
        if (currentPhase === 'night') {
            return player.role === 'mafia' && player.status === 'alive';
        } else if (currentPhase === 'day') {
            return player.status === 'alive';
        }
        return false;
    });

    if (expectedVoters.every(player => player.vote !== null && player.vote !== undefined)) {
        countVotes();
    }
}

function countVotes() {
    const voteCounts = {};
    let voters;

    if (currentPhase === 'night') {
        voters = players.filter(player => player.role === 'mafia' && player.status === 'alive');
    } else if (currentPhase === 'day') {
        voters = players.filter(player => player.status === 'alive');
    }

    voters.forEach(player => {
        if (player.vote) {
            voteCounts[player.vote] = (voteCounts[player.vote] || 0) + 1;
        }
    });

    const maxVotes = Math.max(...Object.values(voteCounts));
    const votedOutPlayerIds = Object.keys(voteCounts).filter(id => voteCounts[id] === maxVotes);

    // Notify the announcer about the vote counts
    notifyAnnouncer({
        type: 'voteCounts',
        voteCounts: voteCounts,
        phase: currentPhase
    });

    if (votedOutPlayerIds.length === 1) {
        const votedOutPlayerId = votedOutPlayerIds[0];
        const votedOutPlayer = players.find(player => player.id === votedOutPlayerId);
        if (votedOutPlayer) {
            votedOutPlayer.status = 'eliminated';
            votedOutPlayer.ws.send(JSON.stringify({ type: 'eliminated', message: 'You have been eliminated!' }));
            // Notify the announcer about the elimination
            notifyAnnouncer({
                type: 'playerEliminated',
                playerId: votedOutPlayer.id,
                phase: currentPhase
            });
        }
    } else {
        // Tie situation
        players.forEach(player => {
            player.ws.send(JSON.stringify({ type: 'tie', message: 'No one was eliminated due to a tie in votes.' }));
        });
        // Notify the announcer about the tie
        notifyAnnouncer({
            type: 'tie',
            message: 'No one was eliminated due to a tie in votes.',
            phase: currentPhase
        });
    }

    if (checkWinConditions()) {
        return;
    }

    // Transition to the next phase
    if (currentPhase === 'night') {
        startDayPhase(votedOutPlayerIds.length === 1 ? votedOutPlayerIds[0] : null);
    } else {
        startNightPhase();
    }
}

function checkWinConditions() {
    const alivePlayers = players.filter(player => player.status === 'alive');
    const mafiaCount = alivePlayers.filter(player => player.role === 'mafia').length;
    const villagerCount = alivePlayers.length - mafiaCount;
    console.log("villagerCount: ", villagerCount, " mafiaCount: ", mafiaCount);

    if (mafiaCount === 0) {
        endGame('Villagers win!');
        return true;
    } else if (mafiaCount >= villagerCount) {
        endGame('Mafia wins!');
        return true;
    }
    return false;
}

function endGame(message) {
    players.forEach(player => {
        player.ws.send(JSON.stringify({ type: 'end', message }));
    });

    // Notify the announcer about the game ending
    notifyAnnouncer({ type: 'end', message });

    console.log(JSON.stringify({ type: 'end', message }));
}

server.listen(3000, () => {
    console.log('Server is listening on port 3000');
});