// ==UserScript==
// @name         ChatGPT API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      3.0
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        none
// @license      MIT
// ==/UserScript==

(() => {
  'use strict';

  // Configuration Constants
  const CONFIG = {
      WS_URL: 'ws://localhost:8765',
      SELECTORS: {
          promptTextarea: '#prompt-textarea',
          sendButton: 'button[data-testid="send-button"]',
          stopButton: 'button.bg-black .icon-lg',
          newChatButton: 'a[data-discover="true"]',
          main: 'main',
          agentTurn: 'div.agent-turn',
          assistantMessage: 'div[data-message-author-role="assistant"]',
      },
      INTERVALS: {
          sleep: 500,
          debounce: 1000,
          reconnectInitial: 2000,
          reconnectMax: 30000,
          heartbeat: 30000,
      },
      TIMEOUTS: {
          waitForElement: 10000,
          waitFor: 5000,
      },
      LOG_PREFIX: 'chatgpt-api-by-browser-script',
  };

  // Utility Functions
  const log = (...args) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`${timestamp} ${CONFIG.LOG_PREFIX}`, ...args);
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const waitForElement = async (selector, timeout = CONFIG.TIMEOUTS.waitForElement) => {
      const interval = CONFIG.INTERVALS.sleep;
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
  class ChatGPTBrowserScript {
      constructor() {
          this.socket = null;
          this.observer = null;
          this.stop = false;
          this.statusDOM = null;
          this.lastText = null;
          this.currentRequestId = null;
          this.debounceTimer = null;
          this.reconnectInterval = CONFIG.INTERVALS.reconnectInitial;
      }

      // Initialize the script on window load
      init() {
          window.addEventListener('load', () => {
              log('Initializing ChatGPT Browser Script');
              this.setupStatusUI();
              this.connectWebSocket();
              setInterval(() => this.sendHeartbeat(), CONFIG.INTERVALS.heartbeat);
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
          log('Connecting to WebSocket at', CONFIG.WS_URL);
          this.socket = new WebSocket(CONFIG.WS_URL);

          this.socket.onopen = () => {
              log('WebSocket connection established');
              this.updateStatus('API', 'green');
              this.reconnectInterval = CONFIG.INTERVALS.reconnectInitial;
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
                  this.handleIncomingData(data);
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
              this.reconnectInterval = Math.min(this.reconnectInterval * 2, CONFIG.INTERVALS.reconnectMax);
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

      // Handle incoming data from WebSocket
      async handleIncomingData(data) {
          log('Processing incoming data:', data);
          await this.processData(data);
      }

      // Process and send data to ChatGPT interface
      async processData(data) {
          const startTime = Date.now();
          try {
              const parsedData = JSON.parse(data.text);
              log('Parsed data:', parsedData);

              const { messages, newChat } = parsedData;

              if (!Array.isArray(messages) || messages.length === 0) {
                  log('Invalid or empty messages array');
                  return;
              }

              const lastMessage = messages[messages.length - 1];
              if (!lastMessage?.content) {
                  log('No valid content in the last message');
                  return;
              }

              const messageContent = lastMessage.content;
              log('Message to send:', messageContent);

              if (newChat) {
                  await this.initNewChat();
              }

              const promptTextarea = await waitForElement(CONFIG.SELECTORS.promptTextarea);
              await sleep(CONFIG.INTERVALS.debounce * 2);
              if (promptTextarea) {
                  this.insertText(promptTextarea, messageContent);
                  const sendButton = await this.waitFor(CONFIG.SELECTORS.sendButton, true);
                  if (sendButton) {
                      sendButton.click();
                      log('Clicked send button');
                      await this.waitFor(CONFIG.SELECTORS.stopButton);
                  } else {
                      log('Send button not enabled');
                  }
              } else {
                  log('Prompt textarea not found');
              }

              this.observeMutations();
              log(`processData() completed in ${Date.now() - startTime}ms`);
          } catch (error) {
              log('Error in processData method:', error);
          }
      }

      // Insert text into a contenteditable element and dispatch necessary events
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
              log('Error during simulatePaste:', error);
          }
      }

      // Wait for a selector to appear and optionally become enabled
      async waitFor(selector, shouldBeEnabled = false, timeout = CONFIG.TIMEOUTS.waitFor) {
          const interval = CONFIG.INTERVALS.sleep;
          let elapsed = 0;
          while (elapsed < timeout) {
              const button = document.querySelector(selector);
              if (button) {
                  if (shouldBeEnabled) {
                      if (!button.disabled) {
                          log(`Button "${selector}" is enabled`);
                          return button;
                      } else {
                          log(`Button "${selector}" is disabled, waiting...`);
                      }
                  } else {
                      log(`Button "${selector}" found`);
                      return button;
                  }
              } else {
                  log(`Button "${selector}" not found, waiting...`);
              }
              await sleep(interval);
              elapsed += interval;
          }
          log(`Timeout: Button "${selector}" not available after ${timeout}ms`);
          return null;
      }

      // Initialize a new chat session
      async initNewChat() {
          const newChatButton = await waitForElement(CONFIG.SELECTORS.newChatButton);
          if (newChatButton) {
              newChatButton.click();
              log('Clicked New Chat button');
              const promptTextarea = await waitForElement(CONFIG.SELECTORS.promptTextarea);
              if (promptTextarea) {
                  log('New chat initiated, prompt textarea available');
              } else {
                  log('Prompt textarea not found after initiating new chat');
              }
          } else {
              log('New Chat button not found');
          }
      }

      // Setup MutationObserver to monitor DOM changes
      observeMutations() {
          if (this.observer) {
              log('MutationObserver already active');
              return;
          }

          const mainElement = document.querySelector(CONFIG.SELECTORS.main);
          if (!mainElement) {
              log('<main> element not found, cannot observe mutations');
              return;
          }

          this.stop = false;

          this.observer = new MutationObserver(mutations => this.handleMutations(mutations, mainElement));
          this.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
          log('MutationObserver set up');
      }

      // Handle DOM mutations detected by MutationObserver
      async handleMutations(mutations, mainElement) {
          log('DOM mutations detected');
          const relevantMutations = mutations.filter(mutation => mainElement.contains(mutation.target));

          if (!relevantMutations.length) return;

          if (this.debounceTimer) clearTimeout(this.debounceTimer);

          this.debounceTimer = setTimeout(async () => {
              const agentTurns = document.querySelectorAll(CONFIG.SELECTORS.agentTurn);
              const lastAgentTurn = agentTurns[agentTurns.length - 1];
              const assistantMessage = lastAgentTurn?.querySelector(CONFIG.SELECTORS.assistantMessage);
              const lastText = assistantMessage?.textContent || '';

              const startButton = document.querySelector(CONFIG.SELECTORS.sendButton);

              if ((!lastText || lastText === this.lastText) && !startButton) {
                  log('No new or changed assistant message');
                  return;
              }

              this.lastText = lastText;
              log('Sending answer to server:', lastText);

              if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                  this.socket.send(JSON.stringify({ type: 'answer', text: lastText }));
              } else {
                  log('Cannot send answer, WebSocket not open');
              }

              if (startButton) {
                  log('Start button detected, disconnecting observer');
                  if (!this.stop) {
                      this.stop = true;
                      this.socket.send(JSON.stringify({ type: 'stop' }));
                      log('Sent stop signal to server');
                  }
                  this.observer.disconnect();
                  this.observer = null;
              }
          }, CONFIG.INTERVALS.debounce);
      }
  }

  // Initialize the application
  new ChatGPTBrowserScript().init();

})();
