const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const cors = require('cors');
const NodeCache = require('node-cache');
const { Worker } = require('worker_threads');

const app = express();
app.use(express.json());
app.use(cors());
app.use(express.static(__dirname));

const cache = new NodeCache({ stdTTL: 3600 }); // Cache results for 1 hour

// Create a connection pool
const axiosInstance = axios.create({
  maxSockets: 100, // Adjust based on your needs and server capacity
  timeout: 5000 // 5 seconds timeout
});

async function checkLink(link) {
  if (link.startsWith('#')) {
    return { url: link, status: true, statusCode: 'Fragment', metaProperties: [], finalUrl: link };
  }

  const cachedResult = cache.get(link);
  if (cachedResult) {
    return cachedResult;
  }

  try {
    const response = await axiosInstance.get(link, {
      maxRedirects: 5,
      validateStatus: function (status) {
        return status >= 200 && status < 400;
      }
    });

    const result = {
      url: link,
      status: true,
      statusCode: response.status,
      metaProperties: [],
      finalUrl: response.request.res.responseUrl || link
    };

    cache.set(link, result);
    return result;
  } catch (error) {
    const errorResult = {
      url: link,
      status: false,
      statusCode: error.response ? error.response.status : null,
      metaProperties: [],
      finalUrl: link
    };
    cache.set(link, errorResult);
    return errorResult;
  }
}

function processLinksWorker(links) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('./linkWorker.js', { workerData: links });
    worker.on('message', resolve);
    worker.on('error', reject);
    worker.on('exit', (code) => {
      if (code !== 0) reject(new Error(`Worker stopped with exit code ${code}`));
    });
  });
}


app.post('/check-links', async (req, res) => {
  const { urls, filterChecked, hierarchyChecked, ariaLabelChecked, imageChecked, metaChecked } = req.body;
  const results = await Promise.all(urls.map(async (url) => {
    try {
      const response = await axiosInstance.get(url);
      const html = response.data;
      const $ = cheerio.load(html);
      const links = [];
      const hierarchy = [];
      const ariaLinks = [];
      const images = [];
      const metaProperties = [];

      function filterHeaderFooter(elements) {
        return elements.filter((index, element) => {
          return $(element).closest('header').length === 0 && $(element).closest('footer').length === 0;
        });
      }

      if (hierarchyChecked) {
        let elements = $('h1, h2, h3, h4, h5, h6');
        if (filterChecked) {
          elements = filterHeaderFooter(elements);
        }
        elements.each((index, element) => {
          hierarchy.push({
            text: $(element).text().replace(/[\t\n]/g, '').trim(),
            tag: $(element).prop('tagName')
          });
        });
      }
      
      if (ariaLabelChecked) {
        let elements = $('a[aria-label]');
        if (filterChecked) {
          elements = filterHeaderFooter(elements);
        }
        elements.each((index, element) => {
          ariaLinks.push({
            ariaLabel: $(element).attr('aria-label').replace(/[\t\n]/g, '').trim(),
            url: $(element).attr('href'),
            target: $(element).attr('target') || '_self'
          });
        });
      }

      if (imageChecked) {
        let elements = $('img');
        if (filterChecked) {
          elements = filterHeaderFooter(elements);
        }
        elements.each((index, element) => {
          images.push({
            src: $(element).attr('src'),
            alt: $(element).attr('alt') ? $(element).attr('alt').replace(/[\t\n]/g, '').trim() : null
          });
        });
      }

      if (metaChecked) {
        $('meta').each((index, element) => {
          const metaTag = {};
          if ($(element).attr('property')) {
            metaTag.property = $(element).attr('property');
            metaTag.content = $(element).attr('content') ? $(element).attr('content').replace(/[\t\n]/g, '').trim() : null;
          } else if ($(element).attr('name')) {
            metaTag.name = $(element).attr('name');
            metaTag.content = $(element).attr('content') ? $(element).attr('content').replace(/[\t\n]/g, '').trim() : null;
          } else {
            metaTag.attribute = $(element).attr('attribute');
            metaTag.content = $(element).attr('content') ? $(element).attr('content').replace(/[\t\n]/g, '').trim() : null;
          }
          if (Object.keys(metaTag).length > 0) {
            metaProperties.push(metaTag);
          }
        });
      }

      if (!hierarchyChecked && !ariaLabelChecked && !imageChecked) {
        let elements = $('a');
        if (filterChecked) {
          elements = filterHeaderFooter(elements);
        }
        elements.each((index, element) => {
          const href = $(element).attr('href');
          if (href && (href.startsWith('http') || href.startsWith('#'))) {
            links.push(href);
          }
        });
      }

      const pageResults = await processLinksWorker(links);
      return { pageUrl: url, links: pageResults, hierarchy, ariaLinks, images, metaProperties };
    } catch (error) {
      console.error('Error fetching the provided URL:', error.message);
      return { pageUrl: url, error: 'Error fetching the provided URL.' };
    }
  }));

  res.json(results);
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});