/**
 * Elderscape Game Logic
 *
 * Handles player stats (HP, Coins) and the separate game chat.
 * Integrates with authentication and player stats APIs.
 */

// --- Authentication DOM elements ---
const authModal = document.getElementById("auth-modal");
const authTitle = document.getElementById("auth-title");
const authErrorMessage = document.getElementById("auth-error-message");
const authUsernameInput = document.getElementById("auth-username");
const authPasswordInput = document.getElementById("auth-password");
const authSubmitButton = document.getElementById("auth-submit-button");
const toggleAuthModeLink = document.getElementById("toggle-auth-mode");

// --- Player Info Bar DOM elements ---
const playerInfoBar = document.getElementById("player-info-bar");
const playerUsernameDisplay = document.getElementById("player-username");

// --- Player Stats DOM elements ---
const hpFill = document.getElementById("hp-fill");
const hpValue = document.getElementById("hp-value");
const coinValue = document.getElementById("coin-value");

// --- Game Chat DOM elements ---
const gameChatMessages = document.getElementById("game-chat-messages");
const gameUserInput = document.getElementById("game-user-input");
const gameSendButton = document.getElementById("game-send-button");

// --- Game State ---
let isLoggedIn = false;
let currentPlayerId = localStorage.getItem("playerId") || null;
let currentUsername = localStorage.getItem("username") || null;
let playerHP = 100;
let playerMaxHP = 100;
let playerCoins = 0; // Initialized to 0, will be fetched from backend

let isRegisterMode = false;
let gameWebSocket: WebSocket | null = null; // WebSocket for game chat

// --- Authentication Functions ---

function showAuthModal() {
  authModal.classList.add("visible");
  document.querySelector(".game-container").style.display = "none";
}

function hideAuthModal() {
  authModal.classList.remove("visible");
  document.querySelector(".game-container").style.display = "grid";
}

function setAuthMode(mode) {
  isRegisterMode = mode === "register";
  authTitle.textContent = isRegisterMode ? "Register for Elderscape" : "Login to Elderscape";
  authSubmitButton.textContent = isRegisterMode ? "Register" : "Login";
  toggleAuthModeLink.textContent = isRegisterMode ? "Login here" : "Register here";
  authErrorMessage.style.display = "none";
}

async function handleAuthSubmit() {
  const username = authUsernameInput.value.trim();
  const password = authPasswordInput.value.trim();

  if (!username || !password) {
    displayAuthError("Please enter both username and password.");
    return;
  }

  const endpoint = isRegisterMode ? "/api/auth/register" : "/api/auth/login";

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ username, password }),
    });

    const data = await response.json();

    if (response.ok) {
      if (!isRegisterMode) {
        // Successful login
        currentPlayerId = data.playerId;
        currentUsername = username;
        localStorage.setItem("playerId", currentPlayerId);
        localStorage.setItem("username", currentUsername);
        isLoggedIn = true;
        hideAuthModal();
        initializeGameUI();
      } else {
        // Successful registration, switch to login mode
        displayAuthError("Registration successful! Please log in.", false);
        setAuthMode("login");
      }
    } else {
      displayAuthError(data.error || "Authentication failed.");
    }
  } catch (error) {
    console.error("Authentication error:", error);
    displayAuthError("An unexpected error occurred.");
  }
}

function displayAuthError(message, isError = true) {
  authErrorMessage.textContent = message;
  authErrorMessage.style.color = isError ? "#a00" : "#0a0";
  authErrorMessage.style.display = "block";
}

// --- Game UI Initialization ---

async function initializeGameUI() {
  if (isLoggedIn && currentPlayerId && currentUsername) {
    playerInfoBar.style.display = "flex";
    playerUsernameDisplay.textContent = currentUsername;
    await fetchPlayerStats();
    connectGameChatWebSocket(); // Connect to game chat
  } else {
    showAuthModal();
  }
}

// --- Player Stats Functions ---

async function fetchPlayerStats() {
  if (!currentPlayerId) return;

  try {
    const response = await fetch(`/api/player_stats?playerId=${currentPlayerId}`);
    const stats = await response.json();

    if (response.ok) {
      playerHP = stats.health;
      playerCoins = stats.coins;
      updateHP(playerHP);
      updateCoins(playerCoins);
    } else {
      console.error("Failed to fetch player stats:", stats.error);
      // Optionally display an error in the game UI
    }
  } catch (error) {
    console.error("Error fetching player stats:", error);
  }
}

/**
 * Updates the HP bar and text display.
 * @param {number} newHP
 */
function updateHP(newHP) {
  playerHP = Math.max(0, Math.min(newHP, playerMaxHP));
  hpFill.style.width = `${(playerHP / playerMaxHP) * 100}%`;
  hpValue.textContent = `${playerHP}/${playerMaxHP}`;
}

/**
 * Updates the coin display.
 * @param {number} newCoins
 */
function updateCoins(newCoins) {
  playerCoins = Math.max(0, newCoins);
  coinValue.textContent = playerCoins;
}

// --- Game Chat Functions (WebSocket) ---

function connectGameChatWebSocket() {
  if (gameWebSocket && gameWebSocket.readyState === WebSocket.OPEN) {
    return; // Already connected
  }

  // Determine WebSocket URL
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const wsUrl = `${protocol}//${window.location.host}/api/game_chat_ws`;

  gameWebSocket = new WebSocket(wsUrl);

  gameWebSocket.onopen = () => {
    console.log("Game chat WebSocket connected.");
    addGameMessageToChat("System", "Connected to global game chat.");
  };

  gameWebSocket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "history") {
      message.messages.forEach((msg) => addGameMessageToChat(msg.sender, msg.content));
    } else if (message.type === "chat") {
      addGameMessageToChat(message.sender, message.content);
    }
  };

  gameWebSocket.onclose = (event) => {
    console.log("Game chat WebSocket closed:", event.code, event.reason);
    addGameMessageToChat("System", "Disconnected from global game chat. Attempting to reconnect...");
    setTimeout(connectGameChatWebSocket, 3000); // Attempt to reconnect after 3 seconds
  };

  gameWebSocket.onerror = (error) => {
    console.error("Game chat WebSocket error:", error);
    addGameMessageToChat("System", "Game chat connection error.");
  };
}

// Auto-resize textarea as user types
gameUserInput.addEventListener("input", function () {
  this.style.height = "auto";
  this.style.height = this.scrollHeight + "px";
});

// Send message on Enter (without Shift)
gameUserInput.addEventListener("keydown", function (e) {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    sendGameMessage();
  }
});

// Send button click handler
gameSendButton.addEventListener("click", sendGameMessage);

/**
 * Sends a message to the game chat via WebSocket.
 */
function sendGameMessage() {
  const messageContent = gameUserInput.value.trim();

  if (messageContent === "" || !gameWebSocket || gameWebSocket.readyState !== WebSocket.OPEN) {
    return;
  }

  const message: WebSocketMessage = {
    type: "chat",
    sender: currentUsername || "Anonymous",
    content: messageContent,
    timestamp: Date.now(),
  };

  gameWebSocket.send(JSON.stringify(message));

  // Clear input
  gameUserInput.value = "";
  gameUserInput.style.height = "auto";
}

/**
 * Helper function to add a message to the game chat.
 * @param {string} sender
 * @param {string} content
 */
function addGameMessageToChat(sender, content) {
  const messageEl = document.createElement("div");
  messageEl.className = "message game-message";
  messageEl.innerHTML = `<p><b>[${sender}]:</b> ${content}</p>`;
  gameChatMessages.appendChild(messageEl);

  // Scroll to bottom
  gameChatMessages.scrollTop = gameChatMessages.scrollHeight;
}

// --- Event Listeners ---
authSubmitButton.addEventListener("click", handleAuthSubmit);
toggleAuthModeLink.addEventListener("click", (e) => {
  e.preventDefault();
  setAuthMode(isRegisterMode ? "login" : "register");
});

// --- Initial Setup ---
// Check if already logged in on page load
if (currentPlayerId && currentUsername) {
  isLoggedIn = true;
  hideAuthModal();
  initializeGameUI();
} else {
  showAuthModal();
  setAuthMode("login"); // Default to login mode
}
