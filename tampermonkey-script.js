// ==UserScript==
// @name         Unified Azure and ChatGPT API Browser Script
// @namespace    http://tampermonkey.net/
// @version      4.0
// @match        https://oai.azure.com/*
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  // Configuration per site
  const CONFIGS = {
      'https://oai.azure.com/': {
          name: 'Azure',
          selectors: {
              promptTextarea: '[aria-label="User message"]',
              sendButton: 'button[data-automation-id="chatControlButton"][aria-label="Send"]',
              stopButton: 'button[data-automation-id="chatControlButton"][aria-label="Stop"]',
              newChatButton: '[data-bi-cn="cg_chatsession_clear-chat"]',
              confirmClearChatButton: '[data-bi-cn="cg_clearchatconfirmationdialog_clear"]',
              main: '#chatGptChatRegion',
              assistantMessage: '[data-automation-id="aiBubbleContent"] p',
              startButton: 'button[data-automation-id="chatControlButton"][aria-label="Send"]',
          },
          logPrefix: 'Azure-API-Script',
      },
      'https://chatgpt.com/': {
          name: 'ChatGPT',
          selectors: {
              promptTextarea: '#prompt-textarea',
              sendButton: 'button[data-testid="send-button"]',
              stopButton: 'button.bg-black .icon-lg',
              newChatButton: 'a[data-discover="true"]',
              confirmClearChatButton: null, // Not applicable or needs to be defined
              main: 'main',
              assistantMessage: 'div[data-message-author-role="assistant"]',
              startButton: 'button[data-testid="send-button"]',
          },
          logPrefix: 'ChatGPT-API-Script',
      },
  };

  // Determine current site configuration
  const currentSite = Object.keys(CONFIGS).find(site => window.location.href.startsWith(site));
  if (!currentSite) {
      console.error('Unified Script: Unsupported site. This script only supports Azure and ChatGPT.');
      return;
  }

  const CONFIG = CONFIGS[currentSite];

  // Utility Functions
  const log = (...args) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`${timestamp} ${CONFIG.logPrefix}`, ...args);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForElement = async (selector, timeout = 10000) => {
      const interval = 500;
      let elapsed = 0;
      while (elapsed < timeout) {
          const element = document.querySelector(selector);
          if (element) return element;
          await sleep(interval);
          elapsed += interval;
      }
      log(`Timeout: Element "${selector}" not found after ${timeout}ms`);
      return null;
  };

  // Main Application Class
  class UnifiedBrowserScript {
      constructor(config) {
          this.config = config;
          this.socket = null;
          this.observer = null;
          this.stop = false;
          this.statusDOM = null;
          this.lastText = null;
          this.currentRequestId = null;
          this.debounceTimer = null;
          this.reconnectInterval = 2000; // Initial reconnect interval
          this.maxReconnectInterval = 30000; // Max reconnect interval
      }

      // Initialize the script on window load
      init() {
          window.addEventListener('load', () => {
              log('Initializing Unified Browser Script');
              this.setupStatusUI();
              this.connectWebSocket();
              setInterval(() => this.sendHeartbeat(), 30000);
          });
      }

      // Setup a fixed UI element to display connection status
      setupStatusUI() {
          this.statusDOM = document.createElement('div');
          Object.assign(this.statusDOM.style, {
              position: 'fixed',
              top: '10px',
              right: '60px',
              zIndex: '9999',
              padding: '5px 10px',
              backgroundColor: '#f0f0f0',
              borderRadius: '5px',
              fontFamily: 'Arial, sans-serif',
              fontSize: '14px',
          });
          this.statusDOM.innerHTML = `<span style="color: black;">API Connecting...</span>`;
          document.body.appendChild(this.statusDOM);
      }

      // Update the status UI
      updateStatus(message, color = 'black') {
          if (this.statusDOM) {
              this.statusDOM.innerHTML = `<span style="color: ${color};">${message}</span>`;
          }
      }

      // Establish WebSocket connection
      connectWebSocket() {
          log('Connecting to WebSocket at', WS_URL);
          this.socket = new WebSocket(WS_URL);

          this.socket.onopen = () => {
              log('WebSocket connection established');
              this.updateStatus('API!', 'green');
              this.reconnectInterval = 2000; // Reset reconnect interval
          };

          this.socket.onclose = () => {
              log('WebSocket connection closed');
              this.updateStatus('API!', 'red');
              this.scheduleReconnect();
          };

          this.socket.onerror = (error) => {
              log('WebSocket error:', error);
              this.updateStatus('API Error!', 'red');
          };

          this.socket.onmessage = (event) => {
              log('WebSocket message received:', event.data);
              try {
                  const data = JSON.parse(event.data);
                  this.currentRequestId = data.id;
                  this.start(data);
              } catch (error) {
                  log('Failed to parse WebSocket message:', error);
              }
          };
      }

      // Schedule reconnection with exponential backoff
      scheduleReconnect() {
          log(`Reconnecting in ${this.reconnectInterval}ms`);
          setTimeout(() => {
              this.connectWebSocket();
              this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
          }, this.reconnectInterval);
      }

      // Send heartbeat to keep the WebSocket connection alive
      sendHeartbeat() {
          if (this.socket && this.socket.readyState === WebSocket.OPEN) {
              log('Sending heartbeat');
              this.socket.send(JSON.stringify({ type: 'heartbeat' }));
          } else {
              log('Cannot send heartbeat, WebSocket not open');
          }
      }

      // Start processing incoming data
      async start(data) {
          log('Start method called with data:', data);
          const startTime = Date.now();

          // Parse the incoming data
          let parsedData;
          try {
              parsedData = JSON.parse(data.text);
              log('Parsed data:', parsedData);
          } catch (error) {
              log('Error parsing data:', error);
              return;
          }

          const { messages, model, newChat } = parsedData;

          this.stop = false;
          log('Starting to send a new message');

          // Validate messages array
          if (!Array.isArray(messages) || messages.length === 0) {
              log('Error: Messages array is empty or invalid');
              return;
          }

          // Extract the last user message to send
          const lastMessage = messages[messages.length - 1];
          if (!lastMessage || !lastMessage.content) {
              log('Error: No valid message content found in the last message');
              return;
          }

          const messageContent = lastMessage.content;
          log('Message content to send:', messageContent);

          // Handle newChat flag
          if (newChat) {
              log('New chat flag detected, initiating new conversation.');
              await this.clickNewChatButton();
              log('New conversation initiated.');
              await sleep(500);
          }

          // Inject the message into the interface
          const promptTextarea = await waitForElement(this.config.selectors.promptTextarea, 10000);
          if (promptTextarea) {
              log('Prompt textarea found, inserting message content');
              await this.insertText(promptTextarea, messageContent);
              const sendButton = await this.waitForButton(this.config.selectors.sendButton, true, 5000);
              if (sendButton) {
                  sendButton.click();
                  log('Send button clicked');
              } else {
                  log('Error: Send button is still disabled after waiting');
              }
              await this.waitForButton(this.config.selectors.stopButton, false, 10000);
          } else {
              log('Error: Prompt textarea not found');
          }

          this.observeMutations();

          log(`Start method completed in ${Date.now() - startTime}ms`);
      }

      // Insert text into the textarea/input
      async insertText(element, text) {
          try {
              // Focus the editor to ensure it can receive the paste event
              element.focus();

              // Create a DataTransfer object and set the plain text data
              const clipboardData = new DataTransfer();
              clipboardData.setData('text/plain', text);

              // Create the paste event with the clipboardData
              const pasteEvent = new Event('paste', {
                  bubbles: true,
                  cancelable: true,
              });

              // Define the clipboardData property on the event
              Object.defineProperty(pasteEvent, 'clipboardData', {
                  value: clipboardData,
              });

              // Dispatch the paste event on the editor
              element.dispatchEvent(pasteEvent);

              log(`Simulated paste of "${text}" into the editor.`);
          } catch (error) {
              log('Error during insertText:', error);
          }
      }

      // Wait for a button to appear and optionally become enabled
      async waitForButton(selector, shouldBeEnabled = false, timeout = 5000) {
          const intervalTime = 500; // Check every 500ms
          let elapsedTime = 0;
          while (elapsedTime < timeout) {
              const button = document.querySelector(selector);
              if (button) {
                  if (shouldBeEnabled) {
                      if (!button.disabled && !button.classList.contains('disabled')) {
                          log('Button found and enabled:', selector);
                          return button;
                      } else {
                          log('Button is disabled, waiting...', selector);
                      }
                  } else {
                      log('Button found:', selector);
                      return button;
                  }
              } else {
                  log('Button is missing, waiting...', selector);
              }
              await sleep(intervalTime);
              elapsedTime += intervalTime;
          }
          log('Button did not become available within the timeout period:', selector);
          return null;
      }

      // Click the "New Chat" button and confirm if necessary
      async clickNewChatButton() {
          const newChatButtonSelector = this.config.selectors.newChatButton;
          if (!newChatButtonSelector) {
              log('No newChatButton selector defined for this site.');
              return;
          }

          const newChatButton = await this.waitForButton(newChatButtonSelector, false, 5000);
          if (newChatButton) {
              newChatButton.click();
              log('New Chat button clicked');
          } else {
              log('Error: Unable to find New Chat button');
              return;
          }

          // If there's a confirmation button, click it
          if (this.config.selectors.confirmClearChatButton) {
              const confirmButton = await this.waitForButton(this.config.selectors.confirmClearChatButton, false, 5000);
              if (confirmButton) {
                  confirmButton.click();
                  log('Confirm Clear Chat button clicked');
              } else {
                  log('Error: Unable to find Confirm Clear Chat button');
              }
          }
      }

      // Setup MutationObserver to monitor DOM changes
      observeMutations() {
          log('Setting up MutationObserver');

          const mainElement = document.querySelector(this.config.selectors.main);
          if (!mainElement) {
              log('Error: Main element not found, cannot observe mutations');
              return;
          }

          if (this.observer) {
              log('MutationObserver is already active');
              return;
          }

          this.observer = new MutationObserver(async (mutations) => {
              log('DOM mutations detected:', mutations);

              // Filter mutations within the main element
              const relevantMutations = mutations.filter(mutation => {
                  return mainElement.contains(mutation.target);
              });

              if (relevantMutations.length === 0) return;

              // Debounce to avoid rapid consecutive triggers
              if (this.debounceTimer) {
                  clearTimeout(this.debounceTimer);
              }

              this.debounceTimer = setTimeout(async () => {
                  const assistantMessageElement = document.querySelector(this.config.selectors.assistantMessage);
                  if (!assistantMessageElement) {
                      log('Error: Assistant message element not found');
                      return;
                  }

                  const lastText = assistantMessageElement.textContent.trim();

                  const startButton = document.querySelector(this.config.selectors.startButton);

                  if ((!lastText || lastText === this.lastText) && !startButton) {
                      log('Error: Last message text not found or unchanged');
                      return;
                  }

                  this.lastText = lastText;
                  log('Sending answer back to server:', lastText);
                  if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                      this.socket.send(JSON.stringify({
                          type: 'answer',
                          text: lastText,
                      }));
                  } else {
                      log('Cannot send answer, WebSocket not open');
                  }

                  if (startButton) {
                      log('Start button found, disconnecting observer');
                      this.observer.disconnect();
                      this.observer = null;

                      if (!this.stop) {
                          this.stop = true;
                          this.socket.send(JSON.stringify({
                              type: 'stop',
                          }));
                          log('Sent stop signal to server');
                      }
                  }
              }, 1000); // 1 second debounce
          });

          const observerConfig = {
              childList: true,
              subtree: true,
              characterData: true,
          };
          this.observer.observe(document.body, observerConfig);
          log('MutationObserver is now observing');
      }
  }

  // WebSocket URL (can be parameterized if needed)
  const WS_URL = `ws://localhost:8765`;

  // Initialize the app with current site configuration
  const app = new UnifiedBrowserScript(CONFIG);
  app.init();

})();
