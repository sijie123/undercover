var db = require('./sql.js');
var async = require('async');
const TelegramBot = require('node-telegram-bot-api');

// replace the value below with the Telegram token you receive from @BotFather
const token = '388002684:AAGkpgTnARWI_uPv1k2VKmiBpbvB6mw5jHY';

// Create a bot that uses 'polling' to fetch new updates
const bot = new TelegramBot(token, {polling: true});

const STOPPED = 0;
const WAITING = 1;
const STARTED = 2;

// Matches "/echo [whatever]"
bot.onText(/\/echo (.+)/, (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message

  const chatId = msg.chat.id;
  const resp = match[1]; // the captured "whatever"

  // send back the matched "whatever" to the chat
  bot.sendMessage(chatId, resp);
});


function join(chat, sender, verbose) {
  if (chat.type != "group" && chat.type != "supergroup") {
    return;
  }

  async.parallel([
    function(callback) {
      isStarted(chat, sender, function(started) {
        if (started) callback(null);
        else callback("START", null);
      })
    },
    function(callback) {
      db.query("SELECT id FROM state WHERE telegramID = ? AND status = ? LIMIT 1", [chat.id, WAITING], function (err, result) {
        if (err) throw err;
        if (result.length == 0) {
          bot.sendMessage(chat.id, "Game has not started! Please create game first with /newgame.");
          callback("GAME", null);
        }
        else {
          callback(null);
        }
      });
    },
    function (callback) {
      db.query("SELECT id FROM players WHERE groupID = ? AND telegramID = ? LIMIT 1", [chat.id, sender.id], function (err, result) {
        if (err) throw err;
        if (result.length != 0) {
          bot.sendMessage(chat.id, "You have already joined the game in " + chat.title);
          callback("PLAYER", null);
        }
        else {
          callback(null);
        }
      });
    }
  ],
// optional callback
  function(err, results) {
    if (err) return;
    db.query("INSERT INTO players VALUE(NULL, ?, ?, FALSE, FALSE, ?, 0)", [sender.id, chat.id, sender.first_name], function (err, result) {
      if (err) throw err;
      console.log("Result: " + result);
      if (verbose) { bot.sendMessage(chat.id, sender.first_name + " has joined the game! Start game with /start if this is the last player!"); }
    });
    
  });

  
  
}

function newgame(chat, sender, verbose) {
  if (chat.type != "group" && chat.type != "supergroup") {
    return;
  }
  db.query("SELECT id FROM state WHERE telegramID = ? LIMIT 1", [chat.id], function (err, result) {
    if (err) throw err;
    console.log("Result: " + result);
    var numRows = result.length;
    if (numRows != 0) {
      //Game waiting
      bot.sendMessage(chat.id, "A game is already in progress. Please wait until the current game is finished.");
    }
    else {
      db.query("INSERT INTO state VALUE(NULL, ?, ?, -1, 1)", [chat.id, WAITING], function (err, result) {
        if (err) throw err;
        console.log("Result: " + result);
        bot.sendMessage(chat.id, sender.first_name + " has started a new game! Join in the fun with /join.");
        join(chat, sender, verbose);
      });
    }
  });
}

function isStarted(chat, sender, callback) {
  db.query("SELECT id FROM started WHERE telegramID = ? LIMIT 1", [sender.id], function (err, result) {
    if (err) throw err;
    if (result.length == 0) {
      bot.sendMessage(chat.id, sender.first_name + ", you need to start a PM with me so that I can send you your word when the game starts. Please /join again after you've started a PM with me.");
      callback(false);
    }
    else {
      callback(true);
    }
  });
}
function started(sender) {
  db.query("SELECT id FROM started WHERE telegramID = ? LIMIT 1", [sender.id], function (err, result) {
    if (err) return;
    if (result.length == 0) {
      //Add
      db.query("INSERT INTO started VALUE(NULL, ?)", [sender.id], function (err, result) {
        if (err) throw err;
        bot.sendMessage(sender.id, "Hello! Thanks for playing this game. If you need help, send me /help and I'll be glad to assist!");
      });
    }
  });
}

function setupgame(chat, finishSetup) {
  async.waterfall([
    function(callback) {
      db.query("SELECT id, normalWord, spyWord FROM wordlist ORDER BY RAND() LIMIT 1", [], function(err, result) {
          if (err) throw err;
          callback(null, result[0].id, result[0].normalWord, result[0].spyWord);
      })
    },
    function(wordID, normalWord, spyWord, callback) {
        // arg1 now equals 'one' and arg2 now equals 'two'
        db.query("UPDATE state SET status = ?, wordID = ?, currentPlayerOrder = 1 WHERE telegramID = ?", [STARTED, wordID, chat.id], function (err,result) {
          if (err) throw err;
          callback(null, normalWord, spyWord);
        });
    },
    function(normalWord, spyWord, callback) {
        // arg1 now equals 'three'
        db.query("UPDATE players SET isSpy = 1 WHERE id IN ( SELECT id FROM ( SELECT id FROM players WHERE groupID = ? ORDER BY RAND() LIMIT 1 ) as tempTable )", [chat.id], function (err, result) {
          if (err) throw err;
          callback(null,normalWord, spyWord);
        });
    },
    function(normalWord, spyWord, callback) {
        // arg1 now equals 'three'
        db.query("SET @sequence:= 0; UPDATE players SET posn = @sequence:=@sequence+1 WHERE id IN ( SELECT id FROM ( SELECT id FROM players WHERE groupID = ? ORDER BY RAND() ) as tempTable )", [chat.id], function (err, result) {
          if (err) throw err;
          callback(null,normalWord, spyWord);
        });
    },
    function(normalWord, spyWord, callback) {
        // arg1 now equals 'three'
        db.query("UPDATE players SET alive = 1 WHERE groupID = ?", [chat.id], function (err,result) {
          if (err) throw err;
          callback(null,normalWord, spyWord);
        });
    }
], function (err, normalWord, spyWord) {
    // result now equals 'done'
    if (err) throw err;
    db.query("SELECT telegramID, isSpy from players WHERE groupID = ?", [chat.id], function(err, result) {
      if (err) throw err;
      for (var i = 0; i < result.length; i++) {
        //console.log(result[i]);
        if (result[i].isSpy) {
          bot.sendMessage(result[i].telegramID, "Your word is " + spyWord);
        }
        else {
          bot.sendMessage(result[i].telegramID, "Your word is " + normalWord);
        }
      }
      finishSetup();
    });
});
}

function cleanupgame(chat) {
  async.parallel([
    function(callback) {
      db.query("DELETE FROM players WHERE groupID = ?", [chat.id], function(err, result) {
        if (err) throw err;
        callback(null);
      });
    },
    function(callback) {
      db.query("DELETE FROM state WHERE telegramID = ?", [chat.id], function(err, result) {
        if (err) throw err;
        callback(null);
      });
    }
    ],
    function(err) {
      if (err) throw err;
    }
  );
}

function countNoPlayers(chat, callback) {
  db.query("SELECT id from players WHERE groupID = ?", [chat.id], function(err, result) {
    if (err) throw err;
    if (result.length <= 3) {
      callback(false);
    }
    else {
      callback(true);
    }
  });
}

function checkEnd(chat, checkBack) {
  async.series([
    function(callback) {
      db.query("SELECT id from players WHERE groupID = ? AND isSpy = 1 AND alive = 1", [chat.id], function(err, result) {
        if (err) throw err;
        if (result.length == 0) {
          //Game has ended
          bot.sendMessage(chat.id, "Game has ended! The spy has lost!");
          callback("END");
        }
        else {
          callback(null);
        }
      });
    },
    function(callback) {
      db.query("SELECT id from players WHERE groupID = ? AND alive = 1", [chat.id], function(err, result) {
        if (err) throw err;
        if (result.length <= 2) {
          //Game has ended
          bot.sendMessage(chat.id, "Game has ended! The spy has won!");
          callback("END");
        }
        else {
          callback(null);
        }
      });
    }
  ],
  function (err) {
    // result now equals 'done'
    if (err) {
      checkBack(true);
      cleanupgame(chat);
      return;
    }
    else {
      checkBack(false);
      return;
    }
  });
}

function promptForVote(chatID) {
  db.query("UPDATE state SET currentPlayerOrder = -1 WHERE telegramID = ? LIMIT 1", [chatID], function(err, result) {
      if (err) throw err;
  });
  db.query("SELECT telegramID as playerID, name FROM players WHERE alive = 1 AND groupID = ?", [chatID], function(err, result) {
      if (err) throw err;
      if (result.length <= 2) {
        throw "Bot has messed up!";
      }
      bot.sendMessage(chatID, "It's voting time!");
      var choices = [];
      for (var i = 0; i < result.length; i++) {
        choices.push([{ text: result[i].name, callback_data: chatID + "SPY!SPY" + result[i].playerID }]);
      }
      
      var options = {
        reply_markup: JSON.stringify({
          inline_keyboard: choices
        })
      };
      for (var i = 0; i < result.length; i++) {
        bot.sendMessage(result[i].playerID, "Who do you want to vote for?", options);
      }
  });
}

function makeVote(voter, voted, chatID, callback) {
  async.series([
    function(callback) {
      db.query("SELECT id FROM players WHERE alive = 1 AND groupID = ? LIMIT 1", [chatID], function(err, result) {
        if (err) throw err;
        if (result.length == 0) {
          //Player dead or response too slow or something.
          callback("DEAD");
        }
        else {
          callback(null);
        }
      });
    },
    function(callback) {
      db.query("SELECT id FROM votes WHERE gameID = ? AND player = ? LIMIT 1", [chatID, voter], function(err, result) {
          if (err) throw err;
          if (result.length != 0) {
            callback("VOTED");
          }
          else {
            callback(null);
          }
      });
    }
  ],
  function(err, result) {
    if (err) { callback(err); return; }
    db.query("INSERT INTO votes VALUES (NULL, ?, ?, ?)", [voter, voted, chatID], function(err, result) {
      if (err) throw err;
      else {
        callback(null);
        return;
      }
    });
  });
  
}

function kill(telegramID, chatID) {
  db.query("SELECT name FROM players WHERE groupID = ? AND telegramID = ? LIMIT 1", [chatID, telegramID], function(err, result) {
      if (err) throw err;
      if (result.length == 0) {
        throw "Bot is confused";
      }
      bot.sendMessage(chatID, result[0].name + " has been voted out!");
  });
  db.query("UPDATE players SET alive = 0 WHERE telegramID = ? AND groupID = ?", [telegramID, chatID], function(err, result) {
    if (err) throw err;
    bot.sendMessage(telegramID, "You have been voted out!");
    beginRound(chatID);
  });
}

function countVote(chatID) {
  console.log("Counting votes for " + chatID);
  async.waterfall([
    function(callback) {
      db.query("SELECT id FROM players WHERE groupID = ? AND alive = 1", [chatID], function(err, result) {
        if (err) throw err;
        callback(null, result.length);
      })
    },
    function(count, callback) {
      db.query("SELECT player, voted FROM votes WHERE gameID = ? ORDER BY id ASC", [chatID], function(err, result) {
        if (err) throw err;
        if (result.length != count) {
          callback("Not Yet");
        }
        else {
          callback(null, result);
        }
      })
    }], function(err, result) {
      if (err) {
        return;
      }
      else {
        var voteList = [];
        for (var i = 0; i < result.length; i++) {
          voteList.push(result[i].voted);
        }
        voteList.sort();
        console.log(voteList);
        
        //First come first serve if even length
        var prev = 0, counter = 0, max = 0, maxwho = 0;
        for (var i = 0; i < voteList.length; i++) {
          if (prev == voteList[i]) counter++;
          else {
            if (counter > max) {
              max = counter;
              maxwho = prev;
            }
            prev = voteList[i];
            counter = 1;
          }
        }
        if (counter > max) {
          max = counter;
          maxwho = prev;
        }
        
        //Kill maxwho
        
        bot.sendMessage(maxwho, "You have been voted out!");
        db.query("DELETE FROM votes WHERE gameID = ?", [chatID], function(err, result) {
          if (err) throw err;
          beginRound(chatID);
        })
        
      }
    })
}

function promptForDescription(chatID) {
  db.query("SELECT state.currentPlayerOrder as playOrder, players.telegramID as playerID, players.name as playerName FROM state INNER JOIN players ON state.currentPlayerOrder = players.posn AND state.telegramID = players.groupID AND state.telegramID = ? LIMIT 1", [chatID], function(err, result) {
      if (err) throw err;
      if (result[0].playOrder <= 0) {
        throw "Bot has messed up!";
      }
      bot.sendMessage(chatID, "It's " + result[0].playerName + "'s turn. Please PM me a short description of your word.");
      bot.sendMessage(result[0].playerID, "It's your turn! Send me a short description of your word.");
  });
}


function beginRound(chat) {
  checkEnd(chat, function(ended) {
    if (ended) return;
    else {
      db.query("SELECT posn FROM players WHERE alive = 1 AND groupID = ? ORDER BY posn ASC", [chat.id], function(err, result) {
          if (err) throw err;
          db.query("UPDATE state SET currentPlayerOrder = ? WHERE telegramID = ?", [result[0].posn, chat.id], function(err, result) {
              if (err) throw err;
              promptForDescription(chat.id);
          });
      });
      
    }
  });
}

function startgame(chat, sender) {
  db.query("SELECT status FROM state WHERE telegramID = ? LIMIT 1", [chat.id], function (err,result) {
    if (err) throw err;
    if (result.length == 0) {
      bot.sendMessage(chat.id, "There's no game ongoing. Starting new game instead...");
      newgame(chat, sender, false);
      return;
    }
    else {
      countNoPlayers(chat, function(enoughPlayers) {
        if (enoughPlayers) {
          bot.sendMessage(chat.id, "Starting game... Check your PM for your word!");
          setupgame(chat, function() {
            beginRound(chat);
          });
        }
        else {
          bot.sendMessage(chat.id, "There aren't enough players! Minimum 4 players required!");
        }
      })
    }
  })
}

bot.onText(/\/help/, (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message
  const chat = msg.chat;
  const sender = msg.from;
  bot.sendMessage(chat.id, "\
The following commands are available: \n\
/help - Gives an overview of commands and rules.\n\
/newgame - Starts a new game of Who Is The Undercover. \n\
/join - Join an existing game. \n\
\n\
*Rules*\n\
This game is played with 4 or more people. 1 person will be the spy. However, nobody, including the spy, will know who the spy is.\n\
Everyone will receive a word or phrase, while the spy will receive another related phrase. (E.g. Sun vs Moon)\n\
Every round, players will take turn to describe this word/phrase.\n\
At the end of the round, players will all vote for who they think is the spy.\n\
The player with the most number of votes will be removed from the game.\n\
In case of tie, votes are counted first come, first served.\n\
If the spy manages to stay in the game until there are 2 people remaining, he wins.\n\
\n\
Tip: Normal players should describe the word vaguely so that the spy cannot guess the word or even infer his own identity as a spy. However, do not be too vague to prevent being voted out.");
});


bot.onText(/\/join/, (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message
  join(msg.chat, msg.from, true);
});

bot.onText(/\/newgame/, (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message

  newgame(msg.chat, msg.from, false);
  
});

bot.onText(/\/start/, (msg, match) => {
  // 'msg' is the received Message from Telegram
  // 'match' is the result of executing the regexp above on the text content
  // of the message

  const chat = msg.chat;
  const sender = msg.from;
  if (chat.type == "private") {
    started(sender);
  }
  else {
    startgame(chat, sender);
  }
});

// Listen for any kind of message. There are different kinds of
// messages.
bot.on('message', (msg) => {
  const chat = msg.chat;

  db.query("SELECT state.telegramID as groupID, state.currentPlayerOrder as playOrder, players.name as playerName FROM state INNER JOIN players ON state.currentPlayerOrder = players.posn AND state.telegramID = players.groupID AND players.telegramID = ? AND players.alive = 1 LIMIT 1", [chat.id], function(err, result) {
      if (err) throw err;
      if (result.length == 0) {
        //Not your turn
      }
      else {
        var grp = result[0].groupID;
        bot.sendMessage(result[0].groupID, result[0].playerName + " described his word as: " + msg.text);
        db.query("UPDATE state, ( SELECT posn, groupID FROM players WHERE groupID = ? AND posn > ? AND alive = 1 ORDER BY posn ASC LIMIT 1 ) tempTable SET state.currentPlayerOrder = tempTable.posn WHERE state.telegramID = tempTable.groupID", [result[0].groupID, result[0].playOrder], function(err, result) {
          if (err) throw err;
          if (result.affectedRows == 0) {
            //Everyone has said something. Time to vote.
            promptForVote(grp);
          }
          else {
            promptForDescription(grp);
          }
          
        });
      }
  })
});

bot.on('callback_query', function (msg) {
  console.log(msg); // msg.data refers to the callback_data
  
  var resp = msg.data.split("SPY!SPY");
  if (resp.length != 2) {
    bot.answerCallbackQuery(msg.id, null);
    return;
  }
  async.series([
    function(callback) {
      db.query("SELECT currentPlayerOrder FROM state WHERE telegramID = ? LIMIT 1", [ resp[0] ], function(err, result) {
        if (err) throw err;
        if (result.length != 1) {
          //Not voting time.
          bot.answerCallbackQuery(msg.id, null);
          bot.editMessageReplyMarkup('', {message_id: msg.message.message_id, chat_id: msg.message.chat.id});
          callback("ERR", null);
          return;
        }
        if (result[0].currentPlayerOrder != -1) {
          //Not voting time.
          bot.answerCallbackQuery(msg.id, null);
          bot.editMessageReplyMarkup('', {message_id: msg.message.message_id, chat_id: msg.message.chat.id});
          callback("ERR", null);
          return;
        }
        callback(null);
      });
    },
    function(callback) {
      makeVote(msg.from.id, resp[1], resp[0], function(err, result) {
          if (err) {
            bot.answerCallbackQuery(msg.id, null);
            bot.editMessageReplyMarkup('', {message_id: msg.message.message_id, chat_id: msg.message.chat.id});
            callback("ERR");
          }
          else {
            bot.answerCallbackQuery(msg.id, null);
            bot.editMessageReplyMarkup('', {message_id: msg.message.message_id, chat_id: msg.message.chat.id});
            bot.sendMessage(msg.message.chat.id, "Thanks for your vote!");
            callback(null);
          }
        });
    }],
    function(err,result) {
      if (err) console.log(err);
      else {
        countVote(resp[0]);
      }
      
    }
  );
});