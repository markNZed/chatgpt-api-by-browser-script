const axios = require('axios');

// Set up the request payload for the API
const data = {
    messages: [
        //{ role: "system", content: "You are a helpful assistant." },
        { role: "user", content: "Hello, world!" }
    ],
    model: "gpt-4" // Replace with your model version if necessary
};

// Make a POST request to the local ChatGPT API
axios.post('http://localhost:8766/v1/chat/completions', data)
    .then(response => {
        console.log("Response from ChatGPT:", JSON.stringify(response.data));
    })
    .catch(error => {
        console.error("Error:", error.message);
    });

