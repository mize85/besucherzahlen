const rp = require('request-promise');
const cheerio = require('cherio');
const fs = require('fs');
const os = require('os');
const path = require('path');
const csv = require('csvtojson');
const moment = require('moment');

let Client = require('ssh2-sftp-client');
let sftp = new Client();

const BASE_URL = "https://besucherzahlen.karls.cloud/admin/visitors"
const SFTP_URL = "pureaisftp.purematic.de"

function downloadFromSFTP(sftpUser, sftpPw, fileName, tmpPath) {
  return sftp.connect({
    host: SFTP_URL,
    port: 2222,
    username: sftpUser,
    password: sftpPw
  }).then(() => {
    const remoteFile = '/' + fileName;
    const localFile = tmpPath + '/' + fileName;
    console.log('Downloading ' + remoteFile);
    return sftp.fastGet(remoteFile, localFile, {}).then(() => {
      console.log('Downloaded to ' + localFile);
      return sftp.end();
    });
  });
}

function parseCurrentData($) {
  return $("table tbody tr").map((i, element) => ({
    Standort: $(element).find('td:nth-of-type(1)').text().trim()
    , "bisherige Besucher": $(element).find('td:nth-of-type(3)').text().trim()
  })).get()
}

function login(user, password) {
  return send({
    user,
    password,
    action: "login"
  });
}

function update(data) {
  return send({
    ...data,
    action: "update"
  });
}

function send(formData) {
  return rp({
    method: 'POST',
    uri: BASE_URL + "/index.php",
    followAllRedirects: true,
    jar: true,
    formData
  })
}

function parseCsv(path) {
  return csv()
    .fromFile(path)
    .then((jsonObj) => {
      return jsonObj;
    });
}

function createTempFolder() {
  return new Promise((resolve, reject) => {
    fs.mkdtemp(path.join(os.tmpdir(), 'sftp-'), (err, folder) => {
      return err ? reject(err) : resolve(folder);
    });
  });
}

function idToLoc(id) {
  const lookup = {
    "120": "loc-2",
    "123": "loc-5",
    "119": "loc-1",
    "122": "loc-4",
    "121": "loc-3",
  }
  return lookup[id];
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function deleteFolderRecursive(folder) {
  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach((file, index) => {
      const curPath = path.join(folder, file);
      if (fs.lstatSync(curPath).isDirectory()) { // recurse
        deleteFolderRecursive(curPath);
      } else { // delete file
        fs.unlinkSync(curPath);
      }
    });
    fs.rmdirSync(folder);
  }
}


if (process.argv.length !== 6) {
  throw new Error(`You need to run node index.js <user> <password> <sftp user> <sftp pw>!`);
}

const USER = process.argv[2];
const PW = process.argv[3];
const SFTP_USER = process.argv[4];
const SFTP_PW = process.argv[5];

async function loop() {
  try {
    const TODAY_FILE_NAME = `Current_${moment(new Date()).format("YYYY-MM-DD")}.csv`;
    console.log(`Started update, looking for sftp file: ${TODAY_FILE_NAME}.`);


    const body = await login(USER, PW);
    const $ = cheerio.load(body);

    const currentData = parseCurrentData($);
    console.log(`Logged in to ${BASE_URL}`);
    console.log(currentData);

    const tmpFolder = await createTempFolder();
    console.log(tmpFolder);

    await downloadFromSFTP(SFTP_USER, SFTP_PW, TODAY_FILE_NAME, tmpFolder);
    const json = await parseCsv(tmpFolder + "/" + TODAY_FILE_NAME);
    console.log(`Found data in ${TODAY_FILE_NAME}:`);
    console.log(json);

    const updates = json.reduce((prev, curr) => {
      const loc = idToLoc(curr.ID);
      if (loc) {
        prev[loc] = curr.CURRENT;
      }
      return prev;
    }, {});

    await update(updates);

    deleteFolderRecursive(tmpFolder);
    console.log(`Deleted ${tmpFolder}.`);
  } catch (e) {
    console.error(e);
    throw e;
  }
}

async function main() {
  while (true) {
    await loop();
    // 10 min
    console.log(`Sleeping 10min...`);
    await sleep(600000)
  }
}

// Start
main();