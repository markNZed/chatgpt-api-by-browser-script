// ==UserScript==
// @name         ChatGPT API By Browser Script
// @namespace    http://tampermonkey.net/
// @version      2.8
// @match        https://chatgpt.com/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=openai.com
// @grant        none
// @license      MIT
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => {
      const timestamp = new Date().toLocaleTimeString();
      console.log(`${timestamp} chatgpt-api-by-browser-script`, ...args);
  }
  log('Script initialized');

  const WS_URL = `ws://localhost:8765`;
  log('WebSocket URL:', WS_URL);

  function sleep(time) {
      return new Promise((resolve) => setTimeout(resolve, time));
  }

  async function waitForElement(selector, timeout = 10000) {
      const intervalTime = 500;
      let elapsedTime = 0;
      while (elapsedTime < timeout) {
          const element = document.querySelector(selector);
          if (element) {
              return element;
          }
          await sleep(intervalTime);
          elapsedTime += intervalTime;
      }
      return null;
  }

  async function waitForNewChatButton(selector, timeout = 10000) {
      const intervalTime = 500; // Check every 500ms
      let elapsedTime = 0;
      while (elapsedTime < timeout) {
          const newChatButton = document.querySelector(selector);
          if (newChatButton) {
              log('New Chat button found');
              return newChatButton;
          }
          log('Waiting for New Chat button to appear...');
          await sleep(intervalTime);
          elapsedTime += intervalTime;
      }
      log('Error: New Chat button not found within the timeout period');
      return null;
  }

  // Main app class
  class App {
      constructor() {
          this.socket = null;
          this.observer = null;
          this.stop = false;
          this.dom = null;
          this.lastText = null; // Track the last message text
          this.currentRequestId = null; // To correlate responses
          this.debounceTimer = null;
          this.debounceDelay = 1000; // 1 second
          this.reconnectInterval = 2000; // 2 seconds
          this.maxReconnectInterval = 30000; // 30 seconds
      }

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

          // Check if messages array is valid
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
              await sleep(1000);
          }

          // Inject the message into the ChatGPT interface
          const promptTextarea = await waitForElement('#prompt-textarea', 10000);
          if (promptTextarea) {
              log('Prompt textarea found, waiting', promptTextarea);
              await sleep(1000);
              log('Prompt inserting message content', promptTextarea);
              this.insertText(promptTextarea, messageContent);

              const sendButton = await this.waitForButton('button[data-testid="send-button"]', true);
              if (sendButton) {
                  sendButton.click();
                  log('Send button clicked');
              } else {
                  log('Error: Send button is still disabled after waiting');
              }
              await this.waitForButton('button.bg-black .icon-lg');
          } else {
              log('Error: Prompt textarea not found');
          }

          this.observeMutations();

          log(`Start method completed in ${Date.now() - startTime}ms`);
      }

      // Helper function to insert text into a contenteditable div
      insertText(element, text) {
        element.focus();
        element.textContent = text;
        // Simulate the input event to ensure the change is recognized by the UI
        const inputEvent = new Event('input', { bubbles: true, cancelable: true });
        element.dispatchEvent(inputEvent);
        const changeEvent = new Event('change', { bubbles: true, cancelable: true });
        element.dispatchEvent(changeEvent);
        const keyupEvent = new KeyboardEvent('keyup', { bubbles: true, cancelable: true });
        element.dispatchEvent(keyupEvent);
      }

      // Helper function to wait for the send button to become enabled
      async waitForButton(buttonSelector, checkEnabled = false, timeout = 5000) {
          const intervalTime = 500; // Check every 500ms
          let elapsedTime = 0;
          while (elapsedTime < timeout) {
              const button = document.querySelector(buttonSelector);
              if (button) {
                if (checkEnabled) {
                  if (!button.disabled) {
                    log('Button found' + buttonSelector);
                    return button;
                  } else {
                    log('Button is disabled, waiting...' + buttonSelector);
                  }
                } else {
                  log('Button found' + buttonSelector);
                  return button;
                }
              } else {
                log('Button is missing, waiting...' + buttonSelector);
              }
              await sleep(intervalTime);
              elapsedTime += intervalTime;
          }
          log('Button did not become enabled within the timeout period');
          return null;
      }

      // Helper function to wait for and click the "New Chat" button
      async clickNewChatButton() {
          const newChatButtonSelector = 'a[data-discover="true"]'; // Update if necessary
          const newChatButton = await waitForNewChatButton(newChatButtonSelector);
          if (newChatButton) {
              newChatButton.click();
              log('New Chat button clicked');
              // Wait until the input field is available
              const promptTextarea = await waitForElement('#prompt-textarea', 10000);
              if (promptTextarea) {
                  log('Interface reset, prompt textarea is available');
              } else {
                  log('Error: Prompt textarea not found after clicking New Chat');
              }
          } else {
              log('Error: Unable to click New Chat button');
          }
      }

      async observeMutations() {
          log('Setting up MutationObserver');

          // Select the <main> element to observe for changes
          const mainElement = document.querySelector('main');
          if (!mainElement) {
              log('Error: <main> element not found, cannot observe mutations');
              return;
          }

          let isStart = false;
          this.observer = new MutationObserver(async (mutations) => {
              log('DOM mutations detected:', mutations);
              // Loop through each mutation and only process relevant ones
              // Filter mutations that are within the <main> element and match the relevant selector
              const relevantMutations = mutations.filter(mutation => {
                  const isWithinMain = mainElement.contains(mutation.target); // Ensure mutation happens within <main>
                  if (!isWithinMain) return false;
              });

              let startButton = document.querySelector('button[data-testid="send-button"]');
              if (startButton) {
                  isStart = true;
              }

              // Clear any existing debounce timer
              if (this.debounceTimer) {
                  clearTimeout(this.debounceTimer);
              }

              // Set a new debounce timer
              this.debounceTimer = setTimeout(async () => {
                  const list = [...document.querySelectorAll('div.agent-turn')];
                  const last = list[list.length - 1];
                  if (!last && !startButton) {
                      log('Error: No last message found');
                      return;
                  }

                  let lastText = last ? last.querySelector('div[data-message-author-role="assistant"]').textContent : '';

                  if ((!lastText || lastText === this.lastText) && !startButton) {
                      log('Error: Last message text not found or unchanged');
                      return;
                  }

                  this.lastText = lastText;
                  log('Sending answer back to server:', lastText);
                  this.socket.send(
                      JSON.stringify({
                          type: 'answer',
                          text: lastText,
                      })
                  );

                  if (startButton) {
                      log('Start button found, disconnecting observer');
                      this.observer.disconnect();

                      if (this.stop) return;
                      this.stop = true;
                      log('Sending stop signal to server');
                      this.socket.send(
                          JSON.stringify({
                              type: 'stop',
                          })
                      );

                  }
              }, this.debounceDelay);
          });

          const observerConfig = {
              childList: true,
              subtree: true,
              characterData: true,
          };
          this.observer.observe(document.body, observerConfig);
          log('MutationObserver is now observing');
      }

      sendHeartbeat() {
          if (this.socket.readyState === WebSocket.OPEN) {
              log('Sending heartbeat');
              this.socket.send(JSON.stringify({ type: 'heartbeat' }));
          } else {
              log('Cannot send heartbeat, WebSocket not open');
          }
      }

      connect() {
          log('Attempting to connect to WebSocket server at:', WS_URL);
          this.socket = new WebSocket(WS_URL);
          this.socket.onopen = () => {
              log('WebSocket connection opened');
              if (this.dom) {
                  this.dom.innerHTML = '<div style="color: green;">API Connected!</div>';
              }
              this.reconnectInterval = 2000; // Reset reconnection interval
          };
          this.socket.onclose = () => {
              log('WebSocket connection closed');
              if (this.dom) {
                  this.dom.innerHTML = '<div style="color: red;">API Disconnected!</div>';
              }

              // Attempt to reconnect with exponential backoff
              setTimeout(() => {
                  log('Attempting to reconnect...');
                  this.connect();
                  this.reconnectInterval = Math.min(this.reconnectInterval * 2, this.maxReconnectInterval);
              }, this.reconnectInterval);
          };
          this.socket.onerror = (error) => {
              log('WebSocket encountered error:', error);
              if (this.dom) {
                  this.dom.innerHTML = '<div style="color: red;">API Error!</div>';
              }
          };
          this.socket.onmessage = (event) => {
              log('WebSocket message received:', event.data);
              try {
                  const data = JSON.parse(event.data);
                  log('Parsed message data:', data);
                  this.currentRequestId = data.id; // Store the request ID
                  this.start(data);
              } catch (error) {
                  log('Error parsing WebSocket message:', error);
              }
          };
      }

      init() {
          window.addEventListener('load', () => {
              log('Window loaded, initializing DOM elements');
              this.dom = document.createElement('div');
              this.dom.style =
                  'position: fixed; top: 10px; right: 10px; z-index: 9999; display: flex; justify-content: center; align-items: center;';
              document.body.appendChild(this.dom);

              this.connect();

              setInterval(() => this.sendHeartbeat(), 30000);
          });
      }
  }

  // Initialize the app
  const app = new App();
  app.init();

})();
