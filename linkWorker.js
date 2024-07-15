const { parentPort, workerData } = require('worker_threads');
const axios = require('axios');

const axiosInstance = axios.create({
  maxSockets: 20,
  timeout: 5000
});

async function checkLink(link) {
  if (link.startsWith('#')) {
    return { url: link, status: true, statusCode: 'Fragment', metaProperties: [], finalUrl: link };
  }

  try {
    const response = await axiosInstance.get(link, {
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });

    return {
      url: link,
      status: true,
      statusCode: response.status,
      metaProperties: [],
      finalUrl: response.request.res.responseUrl || link
    };
  } catch (error) {
    return {
      url: link,
      status: false,
      statusCode: error.response ? error.response.status : null,
      metaProperties: [],
      finalUrl: link
    };
  }
}

async function processLinks(links) {
  const results = await Promise.all(links.map(checkLink));
  return results;
}

processLinks(workerData).then(result => {
  parentPort.postMessage(result);
});