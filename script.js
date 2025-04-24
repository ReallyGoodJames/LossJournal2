// Initialize Dexie database
const db = new Dexie("GriefJournal");
db.version(5).stores({
  messages: "++id, text, timestamp",
  media: "++id, messageId, type, data, thumbnail"
});

// DOM elements
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const messagesDiv = document.getElementById("messages");
const mediaInput = document.getElementById("media-input");

// Modal elements
const modal = document.getElementById("media-modal");
const modalImg = document.getElementById("modal-image");
const modalVideo = document.getElementById("modal-video");
const modalAudio = document.getElementById("modal-audio");
const span = document.getElementsByClassName("close")[0];

// Display loading indicator
function showLoading(message) {
  const loadingDiv = document.createElement("div");
  loadingDiv.className = "loading";
  loadingDiv.innerHTML = `
    <div>${message}</div>
    <div class="loading-spinner"></div>
  `;
  document.body.appendChild(loadingDiv);
  return loadingDiv;
}

// Hide loading indicator
function hideLoading(loadingDiv) {
  if (loadingDiv && loadingDiv.parentNode) {
    loadingDiv.parentNode.removeChild(loadingDiv);
  }
}

// Create thumbnail for video (returns a promise)
function createVideoThumbnail(videoFile) {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    
    video.src = URL.createObjectURL(videoFile);
    video.addEventListener('loadeddata', () => {
      // Create thumbnail at reduced size for performance
      const scale = 200 / video.videoWidth;
      canvas.width = 200;
      canvas.height = video.videoHeight * scale;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      video.pause();
      URL.revokeObjectURL(video.src);
      canvas.toBlob(blob => {
        blobToBase64(blob).then(base64 => resolve(base64));
      }, 'image/jpeg', 0.7); // Reduced quality for smaller size
    });
  });
}

// Display text message
function displayMessage(text, timestamp) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("message");

  const timeString = timestamp 
    ? new Date(timestamp).toLocaleString([], { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    : "Just now";

  messageElement.innerHTML = `
    <div class="message-text">${text}</div>
    <div class="message-time">${timeString}</div>
  `;
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}

// Display media message with lazy loading
function displayMediaMessage(thumbnail, timestamp, type, mediaId) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("message", "media-message");

  const timeString = new Date(timestamp).toLocaleString([], { 
    month: 'short', 
    day: 'numeric', 
    hour: '2-digit', 
    minute: '2-digit' 
  });

  let mediaContent = '';
  if (type.startsWith('image')) {
    mediaContent = `
      <img class="lazy-media" 
           data-src="${thumbnail}" 
           data-type="image" 
           data-id="${mediaId}"
           alt="Image">
    `;
  } 
  else if (type.startsWith('video')) {
    mediaContent = `
      <div class="media-thumbnail" data-type="video" data-id="${mediaId}">
        <img class="lazy-media" 
             data-src="${thumbnail}" 
             style="width:100%;height:100%;object-fit:cover"
             alt="Video thumbnail">
        <div class="play-icon">▶</div>
      </div>
    `;
  }
  else if (type.startsWith('audio')) {
    mediaContent = `
      <div class="media-thumbnail" data-type="audio" data-id="${mediaId}">
        <div class="play-icon">🔊</div>
      </div>
    `;
  }

  messageElement.innerHTML = `
    ${mediaContent}
    <div class="message-time">${timeString}</div>
  `;
  messagesDiv.appendChild(messageElement);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
  
  // Lazy load the media
  lazyLoadMedia(messageElement);
}

// Lazy load media elements when they come into view
function lazyLoadMedia(container) {
  const lazyMedia = container.querySelectorAll('.lazy-media');
  
  const lazyLoad = (element) => {
    if (element.dataset.src) {
      element.src = element.dataset.src;
      element.onload = () => {
        element.classList.add('loaded');
      };
    }
  };

  if ('IntersectionObserver' in window) {
    const lazyObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          lazyLoad(entry.target);
          lazyObserver.unobserve(entry.target);
        }
      });
    });

    lazyMedia.forEach(media => {
      lazyObserver.observe(media);
    });
  } else {
    // Fallback for browsers without IntersectionObserver
    lazyMedia.forEach(lazyLoad);
  }
}

// Save text message
async function saveMessage(text) {
  const id = await db.messages.add({
    text: text,
    timestamp: Date.now()
  });
  return id;
}

// Save media message
async function saveMediaMessage(file) {
  const messageId = await db.messages.add({
    text: "",
    timestamp: Date.now()
  });

  let thumbnail = '';
  if (file.type.startsWith('video')) {
    thumbnail = await createVideoThumbnail(file);
  } else if (file.type.startsWith('image')) {
    thumbnail = await blobToBase64(file);
  }

  const base64Data = await blobToBase64(file);
  const mediaItem = {
    messageId: messageId,
    type: file.type,
    data: base64Data,
    thumbnail: thumbnail
  };

  const mediaId = await db.media.add(mediaItem);
  return { base64Data, type: file.type, mediaId };
}

// Helper: Convert blob to Base64
function blobToBase64(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// Helper: Convert base64 to blob
function base64ToBlob(base64, mimeType) {
  const byteString = atob(base64.split(',')[1]);
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeType });
}

// Load all messages with lazy loading
async function loadMessages() {
  messagesDiv.innerHTML = "";
  const messages = await db.messages.orderBy("timestamp").toArray();

  for (const msg of messages) {
    if (msg.text) {
      displayMessage(msg.text, msg.timestamp);
    } else {
      const media = await db.media.where("messageId").equals(msg.id).first();
      if (media) {
        displayMediaMessage(
          media.thumbnail || media.data, 
          msg.timestamp, 
          media.type,
          media.id
        );
      }
    }
  }
}

// Export all data as ZIP
async function exportData() {
  const loading = showLoading("Preparing export...");
  try {
    const zip = new JSZip();
    const messagesFolder = zip.folder("messages");
    const mediaFolder = zip.folder("media");

    // Export messages as JSON
    const messages = await db.messages.orderBy("timestamp").toArray();
    const messagesWithMedia = await Promise.all(messages.map(async msg => {
      if (!msg.text) {
        const media = await db.media.where("messageId").equals(msg.id).first();
        return { ...msg, media };
      }
      return msg;
    }));
    
    messagesFolder.file("messages.json", JSON.stringify(messagesWithMedia, null, 2));

    // Export media files
    const allMedia = await db.media.toArray();
    await Promise.all(allMedia.map(async (media, index) => {
      const extension = media.type.split('/')[1];
      const filename = `media_${media.id}.${extension}`;
      const blob = base64ToBlob(media.data, media.type);
      mediaFolder.file(filename, blob);
    }));

    // Generate ZIP file
    const content = await zip.generateAsync({ type: "blob" });
    saveAs(content, `grief-journal-export-${new Date().toISOString().split('T')[0]}.zip`);
  } catch (error) {
    console.error("Export failed:", error);
    alert("Export failed. Please check console for details.");
  } finally {
    hideLoading(loading);
  }
}

// Import data from ZIP
async function importData(zipFile) {
  const loading = showLoading("Importing data...");
  try {
    const zip = await JSZip.loadAsync(zipFile);
    
    // Clear existing data
    await db.messages.clear();
    await db.media.clear();

    // Import messages
    const messagesFile = zip.file("messages/messages.json");
    if (!messagesFile) throw new Error("Messages file not found in ZIP");
    
    const messagesData = await messagesFile.async("text");
    const messages = JSON.parse(messagesData);

    // Import messages and media
    for (const msg of messages) {
      if (msg.media) {
        // Handle media message
        const mediaFile = zip.file(`media/media_${msg.media.id}.${msg.media.type.split('/')[1]}`);
        if (!mediaFile) continue;
        
        const blob = await mediaFile.async("blob");
        const base64Data = await blobToBase64(blob);
        
        const messageId = await db.messages.add({
          text: "",
          timestamp: msg.timestamp
        });
        
        await db.media.add({
          messageId: messageId,
          type: msg.media.type,
          data: base64Data,
          thumbnail: msg.media.thumbnail
        });
      } else {
        // Handle text message
        await db.messages.add({
          text: msg.text,
          timestamp: msg.timestamp
        });
      }
    }

    // Reload messages
    await loadMessages();
    alert("Import completed successfully!");
  } catch (error) {
    console.error("Import failed:", error);
    alert("Import failed. Please check console for details.");
  } finally {
    hideLoading(loading);
  }
}

// Reset chat
async function resetChat() {
  if (confirm("Are you sure you want to reset all chat data? This cannot be undone.")) {
    const loading = showLoading("Resetting chat...");
    try {
      await db.messages.clear();
      await db.media.clear();
      messagesDiv.innerHTML = "";
    } catch (error) {
      console.error("Reset failed:", error);
    } finally {
      hideLoading(loading);
    }
  }
}

// Modal functionality
span.onclick = function() {
  modal.style.display = "none";
  modalImg.style.display = "none";
  modalVideo.style.display = "none";
  modalAudio.style.display = "none";
  modalVideo.pause();
  modalAudio.pause();
}

window.onclick = function(event) {
  if (event.target == modal) {
    modal.style.display = "none";
    modalImg.style.display = "none";
    modalVideo.style.display = "none";
    modalAudio.style.display = "none";
    modalVideo.pause();
    modalAudio.pause();
  }
}

// Handle media clicks
document.addEventListener('click', async (e) => {
  const mediaElement = e.target.closest('[data-type]');
  if (!mediaElement) return;

  const mediaId = mediaElement.dataset.id;
  const mediaType = mediaElement.dataset.type;
  const mediaItem = await db.media.get(parseInt(mediaId));

  if (mediaType === 'image') {
    modalImg.src = mediaItem.data;
    modalImg.style.display = "block";
    modal.style.display = "block";
  } 
  else if (mediaType === 'video') {
    modalVideo.src = mediaItem.data;
    modalVideo.style.display = "block";
    modal.style.display = "block";
    modalVideo.play();
  }
  else if (mediaType === 'audio') {
    modalAudio.src = mediaItem.data;
    modalAudio.style.display = "block";
    modal.style.display = "block";
    modalAudio.play();
  }
});

// Initialize app
async function init() {
  const loading = showLoading("Loading your messages...");
  try {
    await loadMessages();
    
    // Handle app installation prompt
    let deferredPrompt;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      
      // Show install button
      const installButton = document.createElement('button');
      installButton.textContent = 'Install App';
      installButton.id = 'install-button';
      installButton.style.display = 'none';
      document.querySelector('.tools').prepend(installButton);
      
      installButton.addEventListener('click', () => {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
          if (choiceResult.outcome === 'accepted') {
            console.log('User accepted install');
          } else {
            console.log('User dismissed install');
          }
          deferredPrompt = null;
        });
      });
      
      // Show the button after a delay
      setTimeout(() => {
        installButton.style.display = 'block';
      }, 5000);
    });

    // Text message handler
    sendButton.addEventListener("click", async () => {
      const text = messageInput.value.trim();
      if (text) {
        await saveMessage(text);
        displayMessage(text, Date.now());
        messageInput.value = "";
      }
    });

    // Media handler
    document.getElementById("add-media-button").addEventListener("click", () => {
      document.getElementById("media-input").click();
    });

    document.getElementById("media-input").addEventListener("change", async (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        for (const file of files) {
          if (file.type.match(/^(image|video|audio)/)) {
            const { base64Data, type, mediaId } = await saveMediaMessage(file);
            displayMediaMessage(
              type.startsWith('image') ? base64Data : await blobToBase64(file),
              Date.now(),
              type,
              mediaId
            );
          }
        }
        e.target.value = "";
      }
    });

    // Tool buttons
    document.getElementById("export-button").addEventListener("click", exportData);
    document.getElementById("import-button").addEventListener("click", () => {
      document.getElementById("import-input").click();
    });
    document.getElementById("import-input").addEventListener("change", (e) => {
      if (e.target.files[0]) importData(e.target.files[0]);
    });
    document.getElementById("reset-button").addEventListener("click", resetChat);

    // Enter key support
    messageInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") sendButton.click();
    });

    // Offline detection
    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    updateOnlineStatus();

  } finally {
    hideLoading(loading);
  }
}

// Update online status
function updateOnlineStatus() {
  if (!navigator.onLine) {
    const offlineWarning = document.createElement('div');
    offlineWarning.className = 'offline-warning';
    offlineWarning.textContent = 'You are offline. Changes will sync when you reconnect.';
    document.body.appendChild(offlineWarning);
  } else {
    const warning = document.querySelector('.offline-warning');
    if (warning) warning.remove();
  }
}

// Start the app
init();