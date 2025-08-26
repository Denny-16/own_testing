const dotenv = require('dotenv');
dotenv.config();

const config = {
  port: process.env.PORT || 5000,
  allowOrigin: process.env.ALLOW_ORIGIN || '*',
};

module.exports = { config };
