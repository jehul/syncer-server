//var createError = require("http-errors");
var express = require("express");
var https = require("https");
var WebSocket = require("ws");
var uuidv4 = require("uuid").v4;

//var path = require("path");
//var cookieParser = require("cookie-parser");
//var logger = require("morgan");

//var indexRouter = require("./routes/index");
//var usersRouter = require("./routes/users");

// in-memory store of all the users
// the keys are the user IDs (strings)
// the values have the form: {
//   id: '3d16d961f67e9792',        // 8 random octets
//   lastKnownUpdateTime: new Date(),
//   sessionId: 'cba82ca5f59a35e6', // id of the session, if one is joined
//   socket: <websocket>,           // the websocket
//   typing: false                  // whether the user is typing or not
// }
const users = new Map();

// in-memory store of all the sessions
// the keys are the session IDs (strings)
// the values have the form: {
//   id: 'cba82ca5f59a35e6',                                                                // 8 random octets
//   lastKnownTime: 123,                                                                    // milliseconds from the start of the video
//   lastKnownTimeUpdatedAt: new Date(),                                                    // when we last received a time update
//   messages: [{ userId: '3d16d961f67e9792', body: 'hello', timestamp: new Date() }, ...], // the chat messages for this session
//   ownerId: '3d16d961f67e9792',                                                           // id of the session owner (if any)
//   paused: true | false,                                                           // whether the video is playing or paused
//   userIds: ['3d16d961f67e9792', ...],                                                    // ids of the users in the session
//   videoId: 123                                                                           // Netflix id the video
// }
const sessions = new Map();

const type = {
  INIT: "INIT",
  PLAYBACK: "PLAYBACK",
  SESSION_INIT: "SESSION_INIT",
  SESSION_ACK: "SESSION_ACK",
  SESSION_JOIN: "SESSION_JOIN"
};

const app = express();

let host = "localhost";
let port = process.env.PORT || 5000;

//initialize a simple http server
const server = http.createServer(app);

//initialize the WebSocket server instance
const wss = new WebSocket.Server({ server });

wss.on("connection", ws => {
  const uuid = generateUUID();
  generateUser(uuid, ws);

  // message passing handler
  //If user has already init
  ws.on("message", message => {
    const parsedMessage = JSON.parse(message);

    //update user time
    updateUser(parsedMessage.uid);

    //user cannot be found immediately return
    if (!users.get(parsedMessage.uid)) return;
    //session initialization LEADER INITIATED
    else if (parsedMessage.type == type.SESSION_INIT) {
      const sessionId = generateUUID();
      //reassign session id to user
      generateUser(uuid, ws, sessionId);
      generateSession(sessionId, parsedMessage);
      console.log("New session started");
      console.log(sessions.get(sessionId));

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: type.SESSION_ACK,
            sessionId: sessionId,
            sessionURL: generateSessionURL(parsedMessage.videoId, sessionId)
          })
        );
      }
    }

    //session initialization FOLLOWER INITIATED
    else if (parsedMessage.type == type.SESSION_JOIN) {
      console.log(parsedMessage);
      const user = users.get(parsedMessage.uid);
      generateUser(user.id, user.ws, parsedMessage.sessionId);
      const session = sessions.get(parsedMessage.sessionId);
      session.users.push(parsedMessage.uid);
      console.log(session);
    }

    //playback controls
    else if (parsedMessage.type == type.PLAYBACK) {
      updateSession(parsedMessage.sessionId, parsedMessage);
      sessions.get(parsedMessage.sessionId).users.forEach(clientId => {
        const user = users.get(clientId);
        if (user.ws.readyState === WebSocket.OPEN) {
          user.ws.send(message);
        }
      });
    }
  });

  //send immediatly a feedback to the incoming connection
  //send user their uid
  ws.send(JSON.stringify({ type: type.INIT, uuid: uuid }));
});

//start our server
server.listen(port, () => {
  console.log(`Server started on port ${server.address().port} :)`);
});

const generateUUID = () => uuidv4();

const generateUser = (uid, ws, sessionId = "") => {
  users.set(uid, {
    id: uid,
    lastKnownUpdateTime: new Date(),
    sessionId: "",
    ws: ws
  });
};

const updateUser = uid => {
  const oldUser = users.get(uid);
  users.set(uid, {
    uid: uid,
    lastKnownUpdateTime: new Date(),
    sessionId: oldUser.sessionId,
    ws: oldUser.ws
  });
};

const generateSession = (sessionId, data) => {
  sessions.set(sessionId, {
    id: sessionId,
    lastKnownTime: 0,
    lastKnownUpdateTime: new Date(),
    ownerId: data.uid,
    paused: false,
    users: [data.uid],
    videoId: data.videoId
  });
};

const updateSession = (sessionId, data) => {
  //console.log("updating session");
  const oldSession = sessions.get(sessionId);
  sessions.set(sessionId, {
    id: sessionId,
    lastKnownTime: data.lastKnownTime,
    lastKnownUpdateTime: new Date(),
    ownerId: data.uid,
    paused: data.paused,
    users: oldSession.users,
    videoId: oldSession.videoId
  });

  //console.log(sessions.get(sessionId));
};

const generateSessionURL = (videoId, sessionId) => {
  const url = `https://netflix.com/watch/${videoId}?sessionId=${sessionId}`;
  return url;
};

const destructSessions = () => {
  const time = new Date();
  time.setHours(time.getHours() - 3);
  sessions.forEach((value, key, map) => {
    if (value.lastKnownUpdateTime < time) {
      console.log(`deleting session: ${key}`);
      map.delete(key);
    }
  });
};

const destructUsers = () => {
  const time = new Date();
  //console.log(users);
  time.setHours(time.getHours() - 3);
  users.forEach((value, key, map) => {
    if (value.lastKnownUpdateTime < time) {
      //close websocket connection
      value.ws.close();
      console.log(`deleting user: ${key}`);
      map.delete(key);
    }
  });
};

const destructor = () => {
  destructSessions();
  destructUsers();
};

//Creating regular cleanup to destroy sessions
setInterval(destructor, 600000); //every 10 minutes
module.exports = app;
