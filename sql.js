var mysql = require('mysql');

var con = mysql.createConnection({
  host: "localhost",
  user: "spysql",
  password: "rNsPRm3Ca2n7",
  database: "spy",
  multipleStatements: true
});

con.connect(function(err) {
  if (err) throw err;
  console.log("Connected!");
});

module.exports = con;