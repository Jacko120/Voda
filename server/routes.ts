import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertCorsRequestSchema, type CorsExecuteRequest, type CorsExecuteResponse } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(app: Express): Promise<Server> {
  // Discover API endpoints from a page
  app.post("/api/discover-endpoints", async (req, res) => {
    try {
      const { mainUrl } = req.body;
      
      console.log(`\nDiscovering API endpoints for: ${mainUrl}`);
      
      // Fetch the page content
      const response = await fetch(mainUrl, {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
          'Accept-Encoding': 'gzip, deflate, br, zstd',
          'Accept-Language': 'en-US,en;q=0.9,en-GB;q=0.8',
          'Cache-Control': 'max-age=0',
          'Connection': 'keep-alive',
          'DNT': '1',
          'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
          'Sec-Ch-Ua-Mobile': '?0',
          'Sec-Ch-Ua-Platform': '"Windows"',
          'Sec-Fetch-Dest': 'document',
          'Sec-Fetch-Mode': 'navigate',
          'Sec-Fetch-Site': 'none',
          'Sec-Fetch-User': '?1',
          'Sec-Gpc': '1',
          'Upgrade-Insecure-Requests': '1',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
        }
      });
      
      const pageContent = await response.text();
      const apiEndpoints = new Set<string>();
      
      // Extract API endpoints using comprehensive patterns
      const patterns = [
        // Direct API paths with various formats
        /["']([^"']*\/api\/[^"'?\s]+(?:\?[^"'\s]*)?)/g,
        /["']([^"']*\/digital\/[^"'?\s]+)/g,
        /["']([^"']*\/content-service\/[^"'?\s]+)/g,
        /["']([^"']*\/eshop\/[^"'?\s]+)/g,
        /["']([^"']*\/auth\/[^"'?\s]+)/g,
        /["']([^"']*\/session\/[^"'?\s]+)/g,
        // Vodafone API URLs
        /["'](https?:\/\/[^"']*vodafone[^"']*\/[^"']*(?:api|digital|content|eshop|auth)[^"'?\s]*(?:\?[^"'\s]*)?)/g,
        // Relative API paths
        /["']([\.\/]*mobile\/[^"']*(?:api|digital|content|eshop|auth)\/[^"'?\s]*(?:\?[^"'\s]*)?)/g,
        // JavaScript variable assignments containing URLs
        /(?:url|endpoint|apiUrl|baseUrl)\s*[:=]\s*["']([^"']+vodafone[^"']*)/gi,
        // Fetch calls
        /fetch\s*\(\s*["']([^"']+)/g,
        // Axios calls
        /axios\.[^(]+\(\s*["']([^"']+)/g,
        // jQuery ajax
        /\$\.ajax\s*\([^)]*url\s*:\s*["']([^"']+)/g,
        // Generic HTTP calls
        /(?:get|post|put|delete|patch)\s*\(\s*["']([^"']+)/gi,
        // Config objects
        /apiConfig\s*[:=]\s*{[^}]*["']([^"']+)/gi,
        // Template literals
        /`([^`]*\/(?:api|digital|content|eshop|auth)\/[^`]*)`/g
      ];
      
      patterns.forEach(pattern => {
        let match;
        while ((match = pattern.exec(pageContent)) !== null) {
          let endpoint = match[1];
          
          // Clean up the endpoint
          endpoint = endpoint.trim();
          
          // Skip obvious non-API URLs
          if (endpoint.includes('.css') || endpoint.includes('.js') || 
              endpoint.includes('.png') || endpoint.includes('.jpg') || 
              endpoint.includes('.gif') || endpoint.includes('.svg') ||
              endpoint.includes('google') || endpoint.includes('facebook') ||
              endpoint.includes('twitter') || endpoint.includes('linkedin')) continue;
          
          // Convert relative URLs to absolute
          if (endpoint.startsWith('/')) {
            endpoint = `https://www.vodafone.co.uk${endpoint}`;
          } else if (endpoint.startsWith('./') || endpoint.startsWith('../')) {
            endpoint = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/${endpoint.replace(/^\.\//, '')}`;
          }
          
          // Include all vodafone URLs that might be APIs
          if (endpoint.includes('vodafone.co.uk') && 
              (endpoint.includes('api') || endpoint.includes('digital') || 
               endpoint.includes('content') || endpoint.includes('eshop') || 
               endpoint.includes('auth') || endpoint.includes('session'))) {
            apiEndpoints.add(endpoint);
          }
        }
      });
      
      const endpointArray = Array.from(apiEndpoints).sort();
      
      console.log(`Found ${endpointArray.length} potential API endpoints:`);
      endpointArray.forEach((endpoint, index) => {
        console.log(`${index + 1}. ${endpoint}`);
      });
      
      res.json({
        success: true,
        pageUrl: mainUrl,
        endpoints: endpointArray,
        totalEndpoints: endpointArray.length
      });
      
    } catch (error) {
      console.error('Error discovering endpoints:', error);
      res.status(500).json({ 
        error: 'Failed to discover endpoints',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Execute CORS bypass
  app.post("/api/cors-execute", async (req, res) => {
    try {
      const { mainUrl, journeyUrl, apiUrl } = req.body as CorsExecuteRequest;
      
      console.log(`*** REQUEST PARAMETERS ***`);
      console.log(`mainUrl: ${mainUrl}`);
      console.log(`journeyUrl: ${journeyUrl}`);
      console.log(`apiUrl: ${apiUrl}`);
      
      // Validate request
      const validatedData = insertCorsRequestSchema.parse({ mainUrl, apiUrl });
      
      // Create request record
      const corsRequest = await storage.createCorsRequest(validatedData);
      
      // Step 1: Fetch cookies from main URL with enhanced bot detection avoidance
      await storage.updateCorsRequest(corsRequest.id, { status: 'fetching_cookies' });
      
      let cookies: Record<string, string> = {};
      try {
        console.log(`Fetching cookies from: ${mainUrl}`);
        
        // FIRST: Get eShop auth cookies from web-shop session endpoint
        console.log('*** STEP 1: Getting eShop auth cookies from web-shop session ***');
        try {
          const authResponse = await fetch('https://www.vodafone.co.uk/web-shop/login/auth/session', {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              'DNT': '1',
              'Connection': 'keep-alive',
              'Referer': 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts',
              'Cache-Control': 'no-cache'
            }
          });
          
          console.log(`eShop auth session status: ${authResponse.status}`);
          
          if (authResponse.ok) {
            const authCookies = authResponse.headers.getSetCookie();
            console.log('eShop auth session set-cookie headers:', authCookies);
            
            for (const cookieHeader of authCookies) {
              const [cookiePair] = cookieHeader.split(';');
              const [name, value] = cookiePair.split('=');
              if (name && value) {
                cookies[name.trim()] = value.trim();
                console.log(`Added eShop cookie: ${name.trim()}`);
                
                // Extract platform session ID from p_id_token
                if (name.trim() === 'eShop-auth-prod1_p_id_token') {
                  try {
                    const decodedToken = decodeURIComponent(value.trim());
                    console.log('Decoded platform token preview:', decodedToken.substring(0, 50) + '...');
                    
                    if (decodedToken.startsWith('j:')) {
                      const jsonData = JSON.parse(decodedToken.substring(2));
                      console.log('Platform session data:', JSON.stringify(jsonData, null, 2));
                      
                      if (jsonData.platformSessionId) {
                        console.log(`*** SUCCESS: Platform Session ID: ${jsonData.platformSessionId} ***`);
                        cookies['platformSessionId'] = jsonData.platformSessionId;
                      }
                    }
                  } catch (error) {
                    console.log('Error parsing platform token:', error);
                  }
                }
              }
            }
          } else {
            console.log('eShop auth session failed with status:', authResponse.status);
          }
        } catch (error) {
          console.log('eShop auth session request failed:', error);
        }
        
        // Skip the bot detection bypass - authentication works fine without it!

        // PRIORITY: Call the web-shop auth session endpoint FIRST
        console.log('*** CALLING WEB-SHOP AUTH SESSION ENDPOINT FIRST ***');
        try {
          const webShopResponse = await fetch('https://www.vodafone.co.uk/web-shop/login/auth/session', {
            method: 'GET',
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
              'Accept': 'application/json',
              'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              'DNT': '1',
              'Connection': 'keep-alive',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
              'Referer': 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts',
              'Cache-Control': 'no-cache'
            }
          });
          
          console.log(`Web-shop auth session status: ${webShopResponse.status}`);
          
          const setCookieHeaders = webShopResponse.headers.getSetCookie();
          console.log('Web-shop auth session cookies:', setCookieHeaders);
          
          for (const cookieHeader of setCookieHeaders) {
            const [cookiePair] = cookieHeader.split(';');
            const [name, value] = cookiePair.split('=');
            if (name && value) {
              cookies[name.trim()] = value.trim();
              console.log(`Added web-shop cookie: ${name.trim()}`);
              
              // Extract platform session ID
              if (name.trim() === 'eShop-auth-prod1_p_id_token') {
                try {
                  const decodedToken = decodeURIComponent(value.trim());
                  if (decodedToken.startsWith('j:')) {
                    const jsonData = JSON.parse(decodedToken.substring(2));
                    if (jsonData.platformSessionId) {
                      console.log(`*** Platform Session ID: ${jsonData.platformSessionId} ***`);
                      cookies['platformSessionId'] = jsonData.platformSessionId;
                    }
                  }
                } catch (error) {
                  console.log('Error parsing platform token:', error);
                }
              }
            }
          }
        } catch (error) {
          console.log('Web-shop auth session failed:', error);
        }

        // Try to trigger the eShop auth token by simulating various authentication flows
        const authFlows = [
          
          // Try OAuth initialization
          { url: 'https://www.vodafone.co.uk/oauth/authorize', method: 'GET', headers: { 'Accept': 'text/html' } },
          { url: 'https://www.vodafone.co.uk/oauth/token', method: 'POST', body: { grant_type: 'client_credentials' } },
          
          // Try different session endpoints with various payloads
          { url: 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/anonymous-session', method: 'POST', body: { anonymous: true } },
          { url: 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/session', method: 'POST', body: {} },
          
          // Try auth initialization with different approaches
          { url: 'https://www.vodafone.co.uk/api/auth/guest', method: 'POST', body: { type: 'guest' } },
          { url: 'https://www.vodafone.co.uk/api/v1/auth/anonymous', method: 'POST', body: {} },
          
          // Try eShop specific endpoints
          { url: 'https://www.vodafone.co.uk/api/eshop/auth/init', method: 'POST', body: {} },
          { url: 'https://www.vodafone.co.uk/eshop/auth/token', method: 'POST', body: { type: 'anonymous' } },
          
          // Try device listing initialization 
          { url: 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/init', method: 'POST', body: {} },
          { url: 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/auth/guest', method: 'POST', body: {} }
        ];

        for (const flow of authFlows) {
          try {
            const currentCookieString = Object.entries(cookies)
              .map(([name, value]) => `${name}=${value}`)
              .join('; ');

            console.log(`Trying ${flow.method} auth flow: ${flow.url}`);
            
            // Special priority handling for the web-shop auth session
            if (flow.url.includes('web-shop/login/auth/session')) {
              console.log(`*** PRIORITY: Calling web-shop auth session endpoint ***`);
            }
            
            const requestHeaders = {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Accept': flow.headers?.Accept || 'application/json, text/plain, */*',
              'Accept-Language': 'en-GB,en-US;q=0.9,en;q=0.8',
              'Accept-Encoding': 'gzip, deflate, br',
              'Cookie': currentCookieString,
              'DNT': '1',
              'Connection': 'keep-alive',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
              'Referer': 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts',
              'Cache-Control': 'no-cache',
              ...(flow.method === 'POST' ? { 'Content-Type': 'application/json' } : {})
            };

            const requestInit = {
              method: flow.method,
              headers: requestHeaders,
              ...(flow.method === 'POST' && flow.body ? { body: JSON.stringify(flow.body) } : {})
            };
            
            const response = await fetch(flow.url, requestInit);

            console.log(`${flow.method} auth flow ${flow.url} status: ${response.status}`);
            
            // Check response body for auth tokens
            if (response.ok) {
              try {
                const responseText = await response.text();
                console.log(`Auth flow response preview: ${responseText.substring(0, 200)}...`);
                
                // Look for tokens in response body
                if (responseText.includes('eShop-auth') || responseText.includes('id_token') || responseText.includes('access_token')) {
                  console.log(`*** FOUND POTENTIAL AUTH TOKEN IN RESPONSE BODY ***`);
                  console.log(`Response contains auth-related content`);
                }
              } catch (e) {
                console.log(`Could not read response body for ${flow.url}`);
              }
            }
            
            const setCookieHeaders = response.headers.getSetCookie();
            for (const cookieHeader of setCookieHeaders) {
              const [cookiePair] = cookieHeader.split(';');
              const [name, value] = cookiePair.split('=');
              if (name && value) {
                cookies[name.trim()] = value.trim();
                console.log(`Added cookie from auth flow: ${name.trim()}`);
                
                // Special check for eShop auth cookie
                if (name.trim().includes('eShop-auth')) {
                  console.log(`*** SUCCESS: FOUND eShop AUTH COOKIE! ***`);
                  
                  // Extract platform session ID from the p_id_token cookie
                  if (name.trim() === 'eShop-auth-prod1_p_id_token') {
                    try {
                      const decodedToken = decodeURIComponent(value.trim());
                      console.log('Decoded platform token:', decodedToken);
                      
                      // Extract JSON from the token (it starts with 'j:')
                      if (decodedToken.startsWith('j:')) {
                        const jsonData = JSON.parse(decodedToken.substring(2));
                        console.log('Platform session data:', JSON.stringify(jsonData, null, 2));
                        
                        if (jsonData.platformSessionId) {
                          console.log(`*** Platform Session ID: ${jsonData.platformSessionId} ***`);
                          // Store it as a separate "cookie" for easier access
                          cookies['platformSessionId'] = jsonData.platformSessionId;
                        }
                      }
                    } catch (error) {
                      console.log('Error parsing platform token:', error);
                    }
                  }
                }
              }
            }

            await new Promise(resolve => setTimeout(resolve, 700));
          } catch (error) {
            console.log(`Auth flow ${flow.url} failed:`, error instanceof Error ? error.message : 'Unknown error');
          }
        }

        // Final summary
        console.log(`Final extracted cookies:`, cookies);
        console.log(`Number of cookies extracted: ${Object.keys(cookies).length}`);
        console.log(`Cookie names: ${Object.keys(cookies).join(', ')}`);

        // Check if we have the auth cookie we're looking for
        if (cookies['eShop-auth-prod1_id_token']) {
          console.log(`SUCCESS: Found eShop-auth-prod1_id_token cookie!`);
        } else {
          console.log(`WARNING: eShop-auth-prod1_id_token cookie not found`);
        }

        console.log(`Final extracted cookies:`, cookies);
        console.log(`Number of cookies extracted: ${Object.keys(cookies).length}`);

        await storage.updateCorsRequest(corsRequest.id, { cookies, status: 'making_api_call' });
      } catch (error) {
        const errorMessage = `Failed to fetch cookies: ${error instanceof Error ? error.message : 'Unknown error'}`;
        await storage.updateCorsRequest(corsRequest.id, { 
          status: 'error', 
          error: errorMessage 
        });
        return res.status(500).json({ error: errorMessage });
      }

      // Step 2: Build dynamic API URL with platform session ID and make API call
      let apiResponse: any;
      try {
        // Replace platform session ID placeholder if needed
        let finalApiUrl = apiUrl;
        if (cookies['platformSessionId'] && apiUrl.includes('*playformsessionid*')) {
          finalApiUrl = apiUrl.replace('*playformsessionid*', cookies['platformSessionId']);
          console.log(`*** REPLACED PLATFORM SESSION ID IN URL ***`);
          console.log(`Original URL: ${apiUrl}`);
          console.log(`Final URL: ${finalApiUrl}`);
        } else if (apiUrl.includes('*playformsessionid*')) {
          console.log(`WARNING: URL requires platform session ID but none was extracted!`);
        }

        const cookieString = Object.entries(cookies)
          .filter(([name]) => name !== 'platformSessionId') // Don't include our extracted ID as a cookie
          .map(([name, value]) => `${name}=${value}`)
          .join('; ');

        // NEW: Initialize journey first if journeyUrl is provided
        if (journeyUrl) {
          let finalJourneyUrl = journeyUrl;
          if (cookies['platformSessionId'] && journeyUrl.includes('*playformsessionid*')) {
            finalJourneyUrl = journeyUrl.replace(/\*playformsessionid\*|\*sessionid\*/g, cookies['platformSessionId']);
          }
          
          console.log(`*** STEP 2A: Initializing journey at: ${finalJourneyUrl} ***`);
          
          const journeyResponse = await fetch(finalJourneyUrl, {
            method: 'GET',
            headers: {
              'Accept': 'application/json, text/plain, */*',
              'Accept-Encoding': 'gzip, deflate, br, zstd',
              'Accept-Language': 'en-US,en;q=0.9,en-GB;q=0.8',
              'Connection': 'keep-alive',
              'Cookie': cookieString,
              'DNT': '1',
              'Referer': 'https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts',
              'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
              'Sec-Ch-Ua-Mobile': '?0',
              'Sec-Ch-Ua-Platform': '"Windows"',
              'Sec-Fetch-Dest': 'empty',
              'Sec-Fetch-Mode': 'cors',
              'Sec-Fetch-Site': 'same-origin',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
            }
          });

          console.log(`Journey initialization status: ${journeyResponse.status}`);
          console.log(`Journey response headers:`, Object.fromEntries(journeyResponse.headers.entries()));
          
          if (!journeyResponse.ok) {
            const journeyError = await journeyResponse.text();
            console.log(`Journey initialization failed: ${journeyError}`);
            throw new Error(`Journey initialization failed: ${journeyResponse.status} - ${journeyError}`);
          } else {
            // Try to read and log the journey response
            const journeyData = await journeyResponse.text();
            console.log(`*** Journey initialized successfully! ***`);
            console.log(`Journey response data:`, journeyData);
          }
        }

        console.log(`*** STEP 2B: Making API call to: ${finalApiUrl} ***`);
        console.log(`Using cookies: ${cookieString}`);

        const apiCallResponse = await fetch(finalApiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
            'Accept-Encoding': 'gzip, deflate, br, zstd',
            'Accept-Language': 'en-US,en;q=0.9,en-GB;q=0.8',
            'Cache-Control': 'max-age=0',
            'Connection': 'keep-alive',
            'Cookie': cookieString,
            'DNT': '1',
            'Host': 'www.vodafone.co.uk',
            'Sec-Ch-Ua': '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
            'Sec-Ch-Ua-Mobile': '?0',
            'Sec-Ch-Ua-Platform': '"Windows"',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Sec-Gpc': '1',
            'Upgrade-Insecure-Requests': '1',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36'
          }
        });

        console.log(`API response status: ${apiCallResponse.status}`);
        console.log(`API response headers:`, Object.fromEntries(apiCallResponse.headers.entries()));

        if (!apiCallResponse.ok) {
          const errorText = await apiCallResponse.text();
          console.log(`API error response body:`, errorText);
          throw new Error(`API call failed with status ${apiCallResponse.status}: ${apiCallResponse.statusText} - ${errorText}`);
        }

        const contentType = apiCallResponse.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          apiResponse = await apiCallResponse.json();
        } else {
          apiResponse = { 
            text: await apiCallResponse.text(),
            contentType: contentType || 'unknown'
          };
        }

        await storage.updateCorsRequest(corsRequest.id, { 
          response: apiResponse, 
          status: 'success' 
        });

        const result: CorsExecuteResponse = {
          id: corsRequest.id,
          cookies,
          apiResponse,
          status: 'success'
        };

        res.json(result);
      } catch (error) {
        const errorMessage = `API call failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
        await storage.updateCorsRequest(corsRequest.id, { 
          status: 'error', 
          error: errorMessage 
        });
        return res.status(500).json({ error: errorMessage });
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: 'Invalid request data', details: error.errors });
      }
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Get request status
  app.get("/api/cors-request/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const corsRequest = await storage.getCorsRequest(id);
      
      if (!corsRequest) {
        return res.status(404).json({ error: 'Request not found' });
      }

      res.json(corsRequest);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      res.status(500).json({ error: errorMessage });
    }
  });

  // Fetch tariffs for a specific device and capacity
  app.post('/api/fetch-tariffs', async (req, res) => {
    try {
      const { deviceId, capacity, cookies } = req.body;
      
      console.log(`*** FETCHING TARIFFS ***`);
      console.log(`Device ID: ${deviceId}`);
      console.log(`Capacity: ${capacity}`);
      
      if (!cookies.platformSessionId) {
        throw new Error('Platform session ID required');
      }

      // Build cookie string for API requests
      const cookieString = Object.entries(cookies)
        .filter(([name]) => name !== 'platformSessionId')
        .map(([name, value]) => `${name}=${value}`)
        .join('; ');

      // Get device details to extract make and model
      const deviceDetailsResponse = await fetch(
        `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-list/paym/v3/${cookies.platformSessionId}/device-groups-listing-journey/device-groups?pageNumber=0&pageSize=200&sort=priority`,
        {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        }
      );

      if (!deviceDetailsResponse.ok) {
        throw new Error(`Failed to fetch device details: ${deviceDetailsResponse.status}`);
      }

      const deviceData = await deviceDetailsResponse.json();
      const device = deviceData.deviceGroups.find((d: any) => d.leadDeviceVariantId === deviceId);
      
      if (!device) {
        throw new Error('Device not found');
      }

      const make = device.make;
      const model = device.model;

      console.log(`Found device: ${make}/${model}`);

      // First, create a new journey by calling the device-group-journeys endpoint
      const createJourneyUrl = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys?segment=Consumer`;
      
      console.log(`Creating journey at: ${createJourneyUrl}`);
      
      const createJourneyResponse = await fetch(createJourneyUrl, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({})
      });

      if (!createJourneyResponse.ok) {
        console.log(`Journey creation failed, trying latest endpoint...`);
        
        // Fallback to getting latest journey
        const latestJourneyUrl = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys/latest?segment=Consumer`;
        
        const latestResponse = await fetch(latestJourneyUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });
        
        if (!latestResponse.ok) {
          throw new Error(`Failed to get journey: ${latestResponse.status}`);
        }
        
        const latestData = await latestResponse.json();
        console.log(`Latest journey response:`, JSON.stringify(latestData, null, 2).substring(0, 400));
        
        // Use "latest" as journey ID for the plans call
        const journeyId = 'latest';
        console.log(`Using journey ID: ${journeyId}`);
        
        // Fetch plans using latest
        const tariffsUrl = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys/${journeyId}/device-variants/${deviceId}/plans`;
        
        console.log(`Fetching tariffs from: ${tariffsUrl}`);
        
        const tariffsResponse = await fetch(tariffsUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json, text/plain, */*',
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
          }
        });

        console.log(`Tariffs response status: ${tariffsResponse.status}`);

        if (!tariffsResponse.ok) {
          const errorText = await tariffsResponse.text();
          console.log(`Tariffs API error: ${errorText}`);
          throw new Error(`Failed to fetch tariffs: ${tariffsResponse.status}`);
        }

        const tariffsData = await tariffsResponse.json();
        console.log(`Successfully fetched tariff data for ${make}/${model}`);
        console.log(`Tariff data structure:`, JSON.stringify(tariffsData, null, 2).substring(0, 500));

        return res.json({
          success: true,
          tariffs: tariffsData.plans || tariffsData.tariffs || tariffsData,
          deviceId,
          capacity,
          make,
          model,
          journeyId,
          debug: {
            journeyUrl: latestJourneyUrl,
            tariffsUrl,
            journeyId,
            responseStatus: tariffsResponse.status
          }
        });
      }

      const journeyData = await createJourneyResponse.json();
      const journeyId = journeyData.id || journeyData.journeyId || 'latest';

      console.log(`Created Journey ID: ${journeyId}`);
      console.log(`Journey creation response:`, JSON.stringify(journeyData, null, 2).substring(0, 300));

      // Follow exact sequence: device-variants -> plans?preBuilt=true -> new-or-existing -> package -> plans
      
      // Step 2: Device variants
      console.log(`=== STEP 2: DEVICE VARIANTS ===`);
      const step2Url = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys/${journeyId}/device-variants`;
      console.log(`Step 2 URL: ${step2Url}`);
      
      const step2Response = await fetch(step2Url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!step2Response.ok) {
        throw new Error(`Step 2 failed: ${step2Response.status}`);
      }
      console.log(`✅ Step 2 complete: ${step2Response.status}`);
      
      const step2Data = await step2Response.json();
      let upfrontPrice = 50; // default
      let deviceMonthlyPrice = 29; // default
      
      // Extract dynamic pricing from device-variants response
      if (step2Data.variants && step2Data.variants.length > 0) {
        const variant = step2Data.variants[0];
        console.log(`*** VARIANT KEYS: ${Object.keys(variant)} ***`);
        console.log(`*** VARIANT SAMPLE: ${JSON.stringify(variant, null, 2).substring(0, 500)}... ***`);
        
        // Look for pricing in different possible locations
        let foundUpfront = false;
        let foundMonthly = false;
        
        // Check various possible field names for upfront price
        const upfrontFields = ['minimumUpfrontPrice', 'upfrontPrice', 'minUpfront', 'upfront'];
        for (const field of upfrontFields) {
          if (variant[field] !== undefined) {
            upfrontPrice = variant[field];
            console.log(`*** FOUND ${field}: £${upfrontPrice} ***`);
            foundUpfront = true;
            break;
          }
        }
        
        // Check various possible field names for device cost/pricing
        const costFields = ['totalDeviceCost', 'deviceCost', 'totalCost', 'cost', 'price'];
        for (const field of costFields) {
          if (variant[field] !== undefined) {
            const totalCost = variant[field];
            deviceMonthlyPrice = Math.round(((totalCost - upfrontPrice) / 36) * 100) / 100;
            console.log(`*** CALCULATED from ${field}: £${deviceMonthlyPrice} (total £${totalCost} - upfront £${upfrontPrice}) / 36 ***`);
            foundMonthly = true;
            break;
          }
        }
        
        // Check for direct monthly price
        if (!foundMonthly) {
          const monthlyFields = ['deviceMonthlyPrice', 'monthlyPrice', 'monthly'];
          for (const field of monthlyFields) {
            if (variant[field] !== undefined) {
              deviceMonthlyPrice = variant[field];
              console.log(`*** FOUND ${field}: £${deviceMonthlyPrice} ***`);
              foundMonthly = true;
              break;
            }
          }
        }
        
        if (!foundUpfront) console.log(`*** NO UPFRONT PRICE FOUND in variant ***`);
        if (!foundMonthly) console.log(`*** NO MONTHLY PRICE FOUND in variant ***`);
        
        console.log(`*** DYNAMIC DEVICE PRICING: ${make} ${model} = Upfront £${upfrontPrice}, Monthly £${deviceMonthlyPrice} ***`);
      } else {
        console.log(`*** NO VARIANTS FOUND, using defaults for ${make} ${model} ***`);
      }

      // Step 3: PreBuilt plans
      console.log(`=== STEP 3: PREBUILT PLANS ===`);
      const step3Url = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys/${journeyId}/device-variants/${deviceId}/plans?preBuilt=true`;
      console.log(`Step 3 URL: ${step3Url}`);
      
      const step3Response = await fetch(step3Url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!step3Response.ok) {
        throw new Error(`Step 3 failed: ${step3Response.status}`);
      }
      console.log(`✅ Step 3 complete: ${step3Response.status}`);

      // Step 4: New or existing customer
      console.log(`=== STEP 4: NEW OR EXISTING CUSTOMER ===`);
      const step4Url = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys/${journeyId}/actions/new-or-existing-customer`;
      console.log(`Step 4 URL: ${step4Url}`);
      
      const step4Response = await fetch(step4Url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify({ isExisting: false })
      });

      if (!step4Response.ok) {
        throw new Error(`Step 4 failed: ${step4Response.status}`);
      }
      console.log(`✅ Step 4 complete: ${step4Response.status}`);

      // Step 5: Package configuration (two requests)
      console.log(`=== STEP 5A: PACKAGE CONFIGURATION (SETUP) ===`);
      const step5Url = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys/${journeyId}/package`;
      console.log(`Step 5A URL: ${step5Url}`);
      
      // First request: confirmConfigurator = false
      const step5aResponse = await fetch(step5Url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-HTTP-Method-Override': 'PATCH',
          'dalHeaders': '{"Accept":"application/hal+json"}'
        },
        body: JSON.stringify({
          "tenure": "36",
          "upfrontPrice": upfrontPrice,
          "deviceMonthlyPrice": deviceMonthlyPrice,
          "confirmConfigurator": false
        })
      });

      if (!step5aResponse.ok) {
        throw new Error(`Step 5A failed: ${step5aResponse.status}`);
      }
      console.log(`✅ Step 5A complete: ${step5aResponse.status}`);

      // Step 5B: Package confirmation
      console.log(`=== STEP 5B: PACKAGE CONFIRMATION ===`);
      
      // Second request: confirmConfigurator = true
      const step5bResponse = await fetch(step5Url, {
        method: 'POST',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Content-Type': 'application/json',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'X-HTTP-Method-Override': 'PATCH',
          'dalHeaders': '{"Accept":"application/hal+json"}'
        },
        body: JSON.stringify({
          "tenure": "36",
          "upfrontPrice": upfrontPrice,
          "deviceMonthlyPrice": deviceMonthlyPrice,
          "confirmConfigurator": true
        })
      });

      if (!step5bResponse.ok) {
        throw new Error(`Step 5B failed: ${step5bResponse.status}`);
      }
      console.log(`✅ Step 5B complete: ${step5bResponse.status}`);

      // Step 6: Final plans (without preBuilt parameter)
      console.log(`=== STEP 6: FINAL PLANS ===`);
      const step6Url = `https://www.vodafone.co.uk/mobile/phones/pay-monthly-contracts/api/digital/v2/device-purchase/paym/v3/${cookies.platformSessionId}/${make}/${model}/device-group-journeys/${journeyId}/device-variants/${deviceId}/plans`;
      console.log(`Step 6 URL: ${step6Url}`);
      
      const step6Response = await fetch(step6Url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json, text/plain, */*',
          'Cookie': cookieString,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!step6Response.ok) {
        throw new Error(`Step 6 failed: ${step6Response.status}`);
      }

      const finalData = await step6Response.json();
      console.log(`🎉 SUCCESS! Final tariffs retrieved: ${step6Response.status}`);
      console.log(`Complete pricing data:`, JSON.stringify(finalData, null, 2));

      res.json({
        success: true,
        data: finalData,
        pricing: finalData.plans || finalData.tariffs || [],
        filters: finalData.filters || {},
        metadata: {
          deviceId,
          capacity,
          make,
          model,
          journeyId
        }
      });

    } catch (error: any) {
      console.error(`Error fetching tariffs: ${error.message}`);
      res.status(500).json({ 
        error: error.message,
        success: false,
        debug: {
          error: error.message,
          stack: error.stack
        }
      });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
