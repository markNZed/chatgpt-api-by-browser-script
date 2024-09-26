const axios = require('axios');

// Function to send a message to the local ChatGPT API and wait for a response
async function sendMessage(message, newChat = false) {
    const data = {
        messages: [
            { role: "user", content: message }
        ],
        model: "gpt-4",
        newChat: newChat
    };

    try {
        const response = await axios.post('http://localhost:8766/v1/chat/completions', data);
        console.log("Response from ChatGPT:", JSON.stringify(response.data));

        // Optionally, extract the content of the assistant's response
        const assistantResponse = response.data.choices[0]?.message?.content;
        console.log("Assistant's response:", assistantResponse);
        return assistantResponse;
    } catch (error) {
        console.error("Error:", error.message);
        return null;
    }
}

// Demo a conversation
(async () => {
    try {
        // Start a new conversation
        const firstResponse = await sendMessage("Hello, world!", true);
        
        // Use the response before sending the next message
        if (firstResponse) {
            console.log("Proceeding after receiving first response...");
            const secondResponse = await sendMessage("How are you today?", false);

            if (secondResponse) {
                console.log("Proceeding after receiving second response...");
                const thirdResponse = await sendMessage("Can you tell me a joke?", false);

                // Optionally log the final response
                if (thirdResponse) {
                    console.log("Final response received:", thirdResponse);
                }
            }
        }
    } catch (error) {
        console.error("Conversation failed:", error);
    }
})();
