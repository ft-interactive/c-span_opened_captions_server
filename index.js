/*
*  www.openedcaptions.com routes captions from C-Span 1 channel to a socket end point.
* This script serves as an itnermediate server to buffer text from socket and expose it as REST API end point.
* * that also support char offset. see README for more info.
*  author: Dan Z @impronunciable
*/
const bertha = require('bertha-client');
const io = require('socket.io-client')
const fs = require('fs')
const http = require('http')
const URL = require('url')
const s = require('underscore.string')
const parseCsv = require('csv-parse/lib/sync')

// Where we stash our stuff
var cache = []

// Setup a cache buster so our cache doesn't use all the memory
const ttl = 20 * 60 * 1000 // 20 mins -> microseconds
const cacheCheckInterval = 5 * 60 * 1000 // 5 mins -> microseconds
setInterval(cleanCache, cacheCheckInterval)

// Setup a transcription file, if desired
var txt = false;
if ( process.env.TRANSCRIPT_FILE ) {
  const transcriptFile = process.env.TRANSCRIPT_FILE
  if ( fs.existsSync(transcriptFile) ) {
    cache.push({t: Date.now(), r: fs.readFileSync(transcriptFile)})
  }

  txt = fs.createWriteStream(transcriptFile, {flag: 'a'})
}

const socket = io.connect('https://openedcaptions.com:443')
socket.on('content', data => {
  if ( txt ) { txt.write(data.data.body) }
  if ( data.data.body === "\r\n" ) { return }
  const dat = {t: Date.now(), r: data.data.body}
  // console.log(dat.t, dat.r)
  cache.push(dat)
})

http.createServer(async (req, res) => {
  const url = URL.parse(req.url, true)

  const now = Date.now()
  const timestamp = parseInt(url.query.since || 0)
  let formattedText = '';
  try {
    formattedText = await formatText(getWordsSince(timestamp));
  } catch (e) {
    formattedText = getWordsSince(timestamp);
    console.error(e);
  }

  if ( url.pathname != '/' ) {
    if (url.pathname === '/visual') {
      res.setHeader('Content-Type', 'text/html')
      res.end(`<html><head></head><body>${formattedText}</body></html>`);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('404 not found')
    }
  } else {
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({
      now: now,
      captions: formattedText,
    }))
  }
}).listen(process.env.PORT || 5000)

async function formatText(str) {
  var ret = str.toLowerCase().replace("\r\n", ' ') // remove random line breaks
  ret = s.clean(ret) // remove redundant spaces

  try {
    // Load proper noun dictionary
    const words = (await bertha.get('1o3kjPOvWCpyHWtBhCd9hTt9KMqus-85CXOHOdO0o1UA', ['words'], { republish: true }))
      .words
      .map(d => [d.matchword, d.ftstyle]);

    // now use our words file to do a bunch of stuff
    words.forEach((pair) => {
      ret = ret
      .replace(new RegExp(` ${pair[0].replace('.', '\\.')}( |\\.|,|:|')`, 'gi'), (match, a) => { return ` ${pair[1]}${a}` })
      .replace(new RegExp(`^${pair[0]}( |\\.|,|:|')`, 'i'), (match, a) => { return `${pair[1]}${a}` })
      .replace(new RegExp(` ${pair[0]}$`, 'i'), pair[1])
    })

    ret = ret
    // Music notes
    .replace(/\s+b\x19\*\s+/, '\n\n🎵\n\n')
    // remove blank space before puncuation
    .replace(/\s+(!|\?|;|:|,|\.|')/g, '$1')
    // handle honorifics
    .replace(/ (sen\.?|rep\.?|mr\.?|mrs\.?|ms\.?|dr\.?) (\w)/gi,
    (match, a, b) => { return ` ${s.capitalize(a)} ${b.toUpperCase()}` })
    // Cap first letter of sentences
    .replace(/(!|\?|:|\.|>>)\s+(\w)/g, (match, a, b) => { return `${a} ${b.toUpperCase()}` })
    // >> seems to be used instead of repeating speaker prompts in back and forths
    .replace(/\s*>>\s*/g, "\n\n>> ")
    // Put speaker prompts on new lines
    .replace(/(\.|"|!|\?|—)\s*([a-zA-Z. ]{2,30}:)/g, '$1\n\n$2')
    return ret;
  } catch (e) {
    throw new Error('Error loading Bertha proper noun dictionary: ', e);
  }
}

function getWordsSince(timestamp) {
  var ret = []
  cache.forEach((val, i) => {
    if ( val.t >= parseInt(timestamp) ) {
      ret.push(val.r)
    }
  })
  return ret.join(' ')
}

function cleanCache() {
  const ttl_check = Date.now() - ttl
  cache.forEach((val, i) => {
    if ( val.t < ttl_check ) {
      delete cache[i]
    }
  })
}
