<script>
	import { io } from "socket.io-client";
	import axios from "axios";
	import { onMount } from "svelte";

	let socket;
	let qrImage = "";
	let connected = false;
	let templates = [];
	let trigger = "";
	let reply = "";
	let statusText = "Bağlantı bekleniyor...";
	let connectionStatus = "connecting";
	let socketId = null;
	let debugInfo = "";
	let retryCount = 0;
	const maxRetries = 3;
	
	// Geçmiş konuşmalar state'leri
	let conversations = [];
	let activeTab = "templates";
	let selectedConversation = null;
	let conversationHistory = [];
	let searchTerm = "";
	let loadingConversations = false;

	onMount(() => {
		initializeSocket();
		checkWhatsAppStatus();
	});

	const initializeSocket = () => {
		try {
			console.log("🔄 Socket bağlantısı başlatılıyor...");
			socket = io("http://localhost:3000", {
				transports: ["websocket", "polling"],
				timeout: 15000,
				reconnection: true,
				reconnectionAttempts: 5,
				reconnectionDelay: 2000,
				forceNew: true
			});

			socket.on("connect", () => {
				console.log("✅ Socket bağlandı:", socket.id);
				socketId = socket.id;
				connectionStatus = "connected";
				statusText = "Sunucuya bağlandı";
				retryCount = 0;
				debugInfo = `Bağlantı ID: ${socket.id}`;
				socket.emit("get_status");
			});

			socket.on("disconnect", (reason) => {
				console.log("❌ Socket bağlantısı kesildi:", reason);
				connectionStatus = "disconnected";
				connected = false;
				statusText = `Bağlantı kesildi: ${reason}`;
				debugInfo = `Son bağlantı hatası: ${reason}`;
			});

			socket.on("connect_error", (error) => {
				console.error("🔌 Bağlantı hatası:", error);
				connectionStatus = "error";
				retryCount++;
				statusText = `Sunucuya bağlanılamıyor (${retryCount}/${maxRetries})`;
				debugInfo = `Hata: ${error.message}`;
				
				if (retryCount >= maxRetries) {
					statusText = "Sunucuya bağlanılamıyor. Lütfen sunucuyu kontrol edin.";
				}
			});

			socket.on("qr", (data) => {
				console.log("📱 QR kod alındı:", data ? "Evet" : "Hayır");
				qrImage = data;
				connected = false;
				connectionStatus = "qr_received";
				statusText = "QR kodu telefonla okutun";
				debugInfo = `QR kod alındı`;
			});

			socket.on("authenticated", () => {
				console.log("🔐 Authenticated");
				connectionStatus = "authenticated";
				statusText = "QR kod okundu, bağlantı kuruluyor...";
				debugInfo = "Kimlik doğrulama başarılı";
			});

			socket.on("ready", () => {
				console.log("✅ WhatsApp bağlandı");
				qrImage = "";
				connected = true;
				connectionStatus = "ready";
				statusText = "✅ WhatsApp bağlı";
				debugInfo = "WhatsApp oturumu aktif";
				loadTemplates();
				loadConversations();
			});

			socket.on("loading_screen", (data) => {
				console.log("🔄 Loading screen:", data);
				statusText = "WhatsApp yükleniyor... " + (data || "");
				debugInfo = `Loading: ${data}`;
			});

			socket.on("whatsapp_status", (data) => {
				console.log("📱 WhatsApp durumu:", data);
				debugInfo = `WhatsApp Status: ${JSON.stringify(data)}`;
				
				if (data.status === 'ready' && data.isReady) {
					connected = true;
					connectionStatus = 'ready';
					statusText = '✅ WhatsApp bağlı';
					qrImage = "";
					loadTemplates();
					loadConversations();
				} else if (data.status === 'restoring_session') {
					connectionStatus = 'connecting';
					statusText = '🔄 Mevcut session yükleniyor...';
				} else if (data.status === 'qr_required') {
					connectionStatus = 'connected';
					statusText = 'QR kod bekleniyor...';
				} else if (data.status === 'authenticated') {
					connectionStatus = 'authenticated';
					statusText = 'Doğrulama başarılı, bağlanıyor...';
				} else if (data.status === 'loading') {
					connectionStatus = 'connecting';
					statusText = `WhatsApp yükleniyor... ${data.progress || ''}`;
				}
			});

			socket.on("message", (data) => {
				console.log("💬 Yeni mesaj:", data);
				loadConversations();
			});

			socket.on("error", (error) => {
				console.error("🚨 Socket error:", error);
				statusText = "Hata: " + (error.message || error);
				debugInfo = `Socket hatası: ${error}`;
			});

		} catch (error) {
			console.error("🚨 Socket initialization error:", error);
			statusText = "Bağlantı başlatılamadı";
			debugInfo = `Init hatası: ${error.message}`;
		}
	};

	const checkWhatsAppStatus = async () => {
		try {
			console.log("🔄 WhatsApp durumu kontrol ediliyor...");
			const response = await axios.get("http://localhost:3000/api/whatsapp-status", { timeout: 5000 });
			console.log("📊 WhatsApp durumu:", response.data);
			
			if (response.data.isReady) {
				connected = true;
				connectionStatus = 'ready';
				statusText = '✅ WhatsApp bağlı';
				qrImage = "";
				loadTemplates();
				loadConversations();
			} else if (response.data.hasSession && !response.data.isReady) {
				statusText = '🔄 Session restore ediliyor...';
				connectionStatus = 'connecting';
			} else if (response.data.hasQr) {
				connectionStatus = 'connected';
				statusText = 'QR kod bekleniyor...';
			}
		} catch (error) {
			console.error("❌ Status kontrol hatası:", error);
		}
	};

	const checkServerStatus = async () => {
		try {
			statusText = "Sunucu kontrol ediliyor...";
			const response = await axios.get("http://localhost:3000/api/status", { timeout: 5000 });
			console.log("✅ Sunucu durumu:", response.data);
			debugInfo = `Sunucu: ${JSON.stringify(response.data)}`;
			statusText = "Sunucu aktif";
		} catch (error) {
			console.error("❌ Sunucu kontrol hatası:", error);
			statusText = "Sunucuya erişilemiyor";
			debugInfo = `Sunucu hatası: ${error.message}`;
		}
	};

	const requestQRCode = async () => {
		try {
			statusText = "QR kod isteniyor...";
			const response = await axios.post("http://localhost:3000/api/request-qr");
			console.log("✅ QR isteği sonucu:", response.data);
			debugInfo = `QR isteği: ${JSON.stringify(response.data)}`;
			statusText = "QR kod isteği gönderildi";
		} catch (error) {
			console.error("❌ QR isteği hatası:", error);
			statusText = "QR kod istenemedi";
			debugInfo = `QR hatası: ${error.message}`;
		}
	};

	const loadTemplates = async () => {
		try {
			console.log("📋 Şablonlar yükleniyor...");
			const res = await axios.get("http://localhost:3000/api/templates");
			templates = res.data;
			console.log("✅ Şablonlar yüklendi:", templates.length);
		} catch (error) {
			console.error("❌ Şablon yükleme hatası:", error);
		}
	};

	const addTemplate = async () => {
		if (trigger.trim() && reply.trim()) {
			try {
				await axios.post("http://localhost:3000/api/templates", {
					trigger: trigger.trim(),
					reply: reply.trim(),
				});
				trigger = "";
				reply = "";
				await loadTemplates();
			} catch (error) {
				console.error("❌ Şablon ekleme hatası:", error);
				alert("Şablon eklenirken hata oluştu: " + error.message);
			}
		} else {
			alert("Lütfen tetikleyici ve cevap alanlarını doldurun.");
		}
	};

	const deleteTemplate = async (index) => {
		if (confirm("Bu şablonu silmek istediğinizden emin misiniz?")) {
			try {
				await axios.delete(`http://localhost:3000/api/templates/${index}`);
				await loadTemplates();
			} catch (error) {
				console.error("❌ Şablon silme hatası:", error);
				alert("Şablon silinirken hata oluştu: " + error.message);
			}
		}
	};

	// Yeni: Geçmiş konuşmalar fonksiyonları
	const loadConversations = async () => {
		if (!connected) return;
		
		try {
			loadingConversations = true;
			console.log("💬 Konuşmalar yükleniyor...");
			const response = await axios.get("http://localhost:3000/api/conversations");
			conversations = Object.values(response.data).sort((a, b) => 
				new Date(b.lastMessageTime) - new Date(a.lastMessageTime)
			);
			console.log("✅ Konuşmalar yüklendi:", conversations.length);
		} catch (error) {
			console.error("❌ Konuşma yükleme hatası:", error);
		} finally {
			loadingConversations = false;
		}
	};

	const loadConversationDetail = async (phone) => {
		try {
			console.log("📞 Konuşma detayı yükleniyor:", phone);
			const response = await axios.get(`http://localhost:3000/api/conversations/${phone}`);
			selectedConversation = response.data;
			conversationHistory = response.data.history || [];
			console.log("✅ Konuşma detayı yüklendi:", conversationHistory.length + " mesaj");
		} catch (error) {
			console.error("❌ Konuşma detay yükleme hatası:", error);
			alert("Konuşma detayı yüklenirken hata oluştu: " + error.message);
		}
	};

	const deleteConversation = async (phone, event) => {
		event.stopPropagation();
		if (confirm("Bu konuşma geçmişini silmek istediğinizden emin misiniz?")) {
			try {
				await axios.delete(`http://localhost:3000/api/conversations/${phone}`);
				if (selectedConversation && selectedConversation.phone === phone) {
					selectedConversation = null;
					conversationHistory = [];
				}
				await loadConversations();
			} catch (error) {
				console.error("❌ Konuşma silme hatası:", error);
				alert("Konuşma silinirken hata oluştu: " + error.message);
			}
		}
	};

	const clearAllConversations = async () => {
		if (confirm("Tüm konuşma geçmişini silmek istediğinizden emin misiniz?")) {
			try {
				await axios.delete("http://localhost:3000/api/conversations");
				selectedConversation = null;
				conversationHistory = [];
				await loadConversations();
			} catch (error) {
				console.error("❌ Tüm konuşmaları silme hatası:", error);
				alert("Konuşmalar silinirken hata oluştu: " + error.message);
			}
		}
	};

	const formatPhoneNumber = (phone) => {
		// WhatsApp numara formatını düzenle
		return phone.replace(/@c\.us$/, "").replace(/\D/g, "").replace(/(\d{3})(\d{3})(\d{4})/, "$1 $2 $3");
	};

	const formatTime = (timestamp) => {
		if (!timestamp) return '';
		const date = new Date(timestamp);
		return date.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
	};

	const formatDate = (timestamp) => {
		if (!timestamp) return '';
		const date = new Date(timestamp);
		return date.toLocaleDateString('tr-TR');
	};

	// Filtrelenmiş konuşmalar
	$: filteredConversations = conversations.filter(conv => 
		conv.phone.toLowerCase().includes(searchTerm.toLowerCase()) ||
		conv.lastMessage.toLowerCase().includes(searchTerm.toLowerCase())
	);

	const logout = async () => {
		if (confirm("WhatsApp bağlantısını kesmek istediğinizden emin misiniz?")) {
			try {
				await axios.post("http://localhost:3000/api/logout");
				connected = false;
				connectionStatus = "connecting";
				statusText = "Çıkış yapılıyor...";
				setTimeout(() => {
					location.reload();
				}, 2000);
			} catch (error) {
				console.error("❌ Çıkış hatası:", error);
				alert("Çıkış yapılırken hata oluştu: " + error.message);
			}
		}
	};

	const restartWhatsApp = async () => {
		if (confirm("WhatsApp bağlantısını yeniden başlatmak istediğinizden emin misiniz?")) {
			try {
				await axios.post("http://localhost:3000/api/restart");
				connected = false;
				connectionStatus = "connecting";
				statusText = "Yeniden başlatılıyor...";
				debugInfo = "Yeniden başlatma isteği gönderildi";
			} catch (error) {
				console.error("❌ Yeniden başlatma hatası:", error);
				alert("Yeniden başlatma sırasında hata oluştu: " + error.message);
			}
		}
	};

	const reconnect = () => {
		if (socket) {
			socket.disconnect();
			socket.connect();
		} else {
			initializeSocket();
		}
	};

	const forceQRRequest = () => {
		if (socket) {
			socket.emit("get_qr");
		}
		requestQRCode();
	};
</script>

<div class="min-h-screen bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900 text-gray-100 w-full overflow-x-hidden">
	<div class="fixed inset-0 overflow-hidden pointer-events-none">
		<div class="absolute -top-40 -right-40 w-80 h-80 bg-purple-500/10 rounded-full blur-3xl"></div>
		<div class="absolute -bottom-40 -left-40 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl"></div>
		<div class="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-green-500/5 rounded-full blur-3xl"></div>
	</div>

	<header class="relative bg-gray-800/30 backdrop-blur-xl border-b border-white/10 shadow-2xl">
		<div class="container mx-auto px-4 py-4">
			<div class="flex flex-col sm:flex-row items-center justify-between gap-4">
				<div class="flex items-center space-x-3">
					<div class="w-12 h-12 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center shadow-lg">
						<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
						</svg>
					</div>
					<div>
						<h1 class="text-2xl font-bold text-white bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
							WhatsApp Asistanı
						</h1>
						<div class="flex items-center space-x-2 mt-1">
							{#if connectionStatus === 'connecting'}
								<div class="w-2 h-2 bg-yellow-400 rounded-full animate-pulse"></div>
								<p class="text-yellow-400 text-sm font-medium">{statusText}</p>
							{:else if connectionStatus === 'connected'}
								<div class="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
								<p class="text-blue-400 text-sm font-medium">{statusText}</p>
							{:else if connectionStatus === 'qr_received'}
								<div class="w-2 h-2 bg-purple-400 rounded-full animate-pulse"></div>
								<p class="text-purple-400 text-sm font-medium">{statusText}</p>
							{:else if connectionStatus === 'authenticated'}
								<div class="w-2 h-2 bg-orange-400 rounded-full animate-pulse"></div>
								<p class="text-orange-400 text-sm font-medium">{statusText}</p>
							{:else if connectionStatus === 'ready'}
								<div class="w-2 h-2 bg-green-400 rounded-full"></div>
								<p class="text-green-400 text-sm font-medium">{statusText}</p>
							{:else}
								<div class="w-2 h-2 bg-red-400 rounded-full"></div>
								<p class="text-red-400 text-sm font-medium">{statusText}</p>
							{/if}
						</div>
					</div>
				</div>
				
				<div class="flex flex-wrap items-center gap-2 justify-center">
					{#if socketId}
						<div class="px-3 py-1 bg-white/10 backdrop-blur-sm rounded-full text-xs text-gray-300 border border-white/10">
							ID: {socketId.substring(0, 8)}...
						</div>
					{/if}
					
					<div class="flex flex-wrap gap-2">
						<button 
							on:click={checkServerStatus}
							class="px-3 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-white/10 hover:border-white/20 flex items-center space-x-1 shadow-lg hover:shadow-xl"
							title="Sunucu Durumunu Kontrol Et"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
							</svg>
							<span class="hidden xs:inline">Sunucu</span>
						</button>
						
						{#if connectionStatus === 'connected' || connectionStatus === 'ready'}
							<button 
								on:click={forceQRRequest}
								class="px-3 py-2 bg-purple-500/20 hover:bg-purple-500/30 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-purple-500/30 hover:border-purple-500/50 flex items-center space-x-1 shadow-lg hover:shadow-xl"
								title="QR Kod İste"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
								</svg>
								<span class="hidden xs:inline">QR İste</span>
							</button>
						{/if}

						{#if connected}
							<button 
								on:click={restartWhatsApp}
								class="px-3 py-2 bg-orange-500/20 hover:bg-orange-500/30 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-orange-500/30 hover:border-orange-500/50 flex items-center space-x-1 shadow-lg hover:shadow-xl"
								title="Yeniden Başlat"
							>
								<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
								</svg>
								<span class="hidden xs:inline">Yeniden Başlat</span>
							</button>
						{/if}
						
						<button 
							on:click={reconnect}
							class="px-3 py-2 bg-blue-500/20 hover:bg-blue-500/30 backdrop-blur-sm text-white text-sm rounded-xl transition-all duration-300 border border-blue-500/30 hover:border-blue-500/50 flex items-center space-x-1 shadow-lg hover:shadow-xl"
							title="Yeniden Bağlan"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
							</svg>
							<span class="hidden xs:inline">Yenile</span>
						</button>
					</div>
				</div>
			</div>
		</div>
	</header>

	<main class="relative container mx-auto px-3 sm:px-4 py-6 sm:py-8">
		{#if debugInfo}
			<div class="max-w-6xl mx-auto mb-6">
				<div class="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-4 shadow-2xl">
					<div class="flex items-center justify-between">
						<span class="text-gray-400 text-sm font-mono truncate">Debug: {debugInfo}</span>
						<button 
							on:click={() => debugInfo = ""}
							class="text-gray-500 hover:text-gray-300 transition-colors flex-shrink-0 ml-2"
						>
							<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
							</svg>
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if connectionStatus === 'error' || connectionStatus === 'disconnected'}
			<div class="max-w-2xl mx-auto mb-6">
				<div class="bg-red-500/10 backdrop-blur-xl border border-red-500/20 rounded-2xl p-4 shadow-2xl">
					<div class="flex items-center space-x-3">
						<svg class="w-6 h-6 text-red-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
						</svg>
						<div class="flex-1">
							<h3 class="text-red-300 font-semibold">Bağlantı Sorunu</h3>
							<p class="text-red-400 text-sm mt-1">
								Sunucuya bağlanılamıyor. Lütfen sunucunun çalıştığından emin olun.
							</p>
						</div>
					</div>
				</div>
			</div>
		{/if}

		{#if qrImage && !connected}
			<div class="max-w-md mx-auto bg-white/5 backdrop-blur-xl rounded-3xl shadow-2xl p-6 border border-white/10">
				<div class="text-center mb-6">
					<div class="w-16 h-16 bg-gradient-to-br from-purple-500 to-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
						<svg class="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
						</svg>
					</div>
					<h2 class="text-2xl font-bold text-white mb-2">QR Kod ile Bağlan</h2>
					<p class="text-gray-400">WhatsApp uygulamasından QR kodu okutun</p>
				</div>
				<div class="bg-white/10 backdrop-blur-sm p-6 rounded-2xl border border-white/10 shadow-lg">
					<img
						src={`https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qrImage)}&size=300x300`}
						alt="QR Code"
						class="w-full max-w-xs mx-auto rounded-xl shadow-lg"
					/>
				</div>
				<div class="mt-6 p-4 bg-blue-500/10 backdrop-blur-sm border border-blue-500/20 rounded-2xl">
					<p class="text-blue-300 text-sm text-center font-medium">
						📱 WhatsApp > Ayarlar > Bağlı Cihazlar > Cihaz Bağla
					</p>
				</div>
			</div>
		{/if}

		{#if (connectionStatus === 'connected' || connectionStatus === 'connecting') && !qrImage && !connected}
			<div class="max-w-2xl mx-auto">
				<div class="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 text-center shadow-2xl">
					<div class="w-20 h-20 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
						<svg class="w-10 h-10 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
						</svg>
					</div>
					<h3 class="text-2xl font-bold text-white mb-3">Session Yükleniyor</h3>
					<p class="text-gray-400 mb-8 text-lg">
						{statusText}
					</p>
					<div class="flex flex-col sm:flex-row gap-4 justify-center">
						<button 
							on:click={forceQRRequest}
							class="px-6 py-4 bg-gradient-to-r from-purple-500 to-purple-600 hover:from-purple-600 hover:to-purple-700 text-white rounded-2xl transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-3 font-semibold"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"/>
							</svg>
							<span>Yeni QR Kod İste</span>
						</button>
						<button 
							on:click={checkServerStatus}
							class="px-6 py-4 bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white rounded-2xl transition-all duration-300 border border-white/10 hover:border-white/20 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center justify-center space-x-3 font-semibold"
						>
							<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
								<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
							</svg>
							<span>Durumu Kontrol Et</span>
						</button>
					</div>
				</div>
			</div>
		{/if}

		{#if connectionStatus === 'connecting' && !qrImage && !connected}
			<div class="max-w-md mx-auto text-center">
				<div class="bg-white/5 backdrop-blur-xl rounded-3xl p-8 border border-white/10 shadow-2xl">
					<div class="w-20 h-20 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-6"></div>
					<h3 class="text-2xl font-bold text-white mb-3">Bağlantı Kuruluyor</h3>
					<p class="text-gray-400 text-lg">{statusText}</p>
				</div>
			</div>
		{/if}

		{#if connected}
			<div class="max-w-6xl mx-auto space-y-8">
				<!-- Dashboard Stats -->
				<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
					<div class="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-gray-400 text-sm font-medium">Bağlantı</p>
								<p class="text-3xl font-bold bg-gradient-to-r from-green-400 to-green-600 bg-clip-text text-transparent">Aktif</p>
							</div>
							<div class="w-14 h-14 bg-gradient-to-br from-green-400 to-green-600 rounded-2xl flex items-center justify-center shadow-lg">
								<svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
								</svg>
							</div>
						</div>
					</div>

					<div class="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-gray-400 text-sm font-medium">Toplam Şablon</p>
								<p class="text-3xl font-bold bg-gradient-to-r from-blue-400 to-blue-600 bg-clip-text text-transparent">{templates.length}</p>
							</div>
							<div class="w-14 h-14 bg-gradient-to-br from-blue-400 to-blue-600 rounded-2xl flex items-center justify-center shadow-lg">
								<svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
								</svg>
							</div>
						</div>
					</div>

					<div class="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-gray-400 text-sm font-medium">Toplam Konuşma</p>
								<p class="text-3xl font-bold bg-gradient-to-r from-purple-400 to-purple-600 bg-clip-text text-transparent">{conversations.length}</p>
							</div>
							<div class="w-14 h-14 bg-gradient-to-br from-purple-400 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
								<svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
								</svg>
							</div>
						</div>
					</div>

					<div class="bg-white/5 backdrop-blur-xl rounded-2xl p-6 border border-white/10 shadow-2xl hover:shadow-3xl transition-all duration-300 hover:scale-105">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-gray-400 text-sm font-medium">Toplam Mesaj</p>
								<p class="text-3xl font-bold bg-gradient-to-r from-orange-400 to-orange-600 bg-clip-text text-transparent">
									{conversations.reduce((total, conv) => total + conv.messageCount, 0)}
								</p>
							</div>
							<div class="w-14 h-14 bg-gradient-to-br from-orange-400 to-orange-600 rounded-2xl flex items-center justify-center shadow-lg">
								<svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z"/>
								</svg>
							</div>
						</div>
					</div>
				</div>

				<!-- Tab Navigation -->
				<div class="bg-white/5 backdrop-blur-xl rounded-3xl shadow-2xl border border-white/10 overflow-hidden">
					<div class="border-b border-white/10">
						<nav class="flex space-x-8 px-6">
							<button
								class={`py-4 px-2 border-b-2 font-medium text-sm transition-all duration-300 ${
									activeTab === 'templates'
										? 'border-green-500 text-green-400'
										: 'border-transparent text-gray-400 hover:text-gray-300'
								}`}
								on:click={() => activeTab = 'templates'}
							>
								<div class="flex items-center space-x-2">
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
									</svg>
									<span>Hazır Cevaplar</span>
									{#if templates.length > 0}
										<span class="bg-green-500/20 text-green-300 px-2 py-1 rounded-full text-xs">
											{templates.length}
										</span>
									{/if}
								</div>
							</button>
							<button
								class={`py-4 px-2 border-b-2 font-medium text-sm transition-all duration-300 ${
									activeTab === 'conversations'
										? 'border-blue-500 text-blue-400'
										: 'border-transparent text-gray-400 hover:text-gray-300'
								}`}
								on:click={() => {
									activeTab = 'conversations';
									loadConversations();
								}}
							>
								<div class="flex items-center space-x-2">
									<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
									</svg>
									<span>Geçmiş Konuşmalar</span>
									{#if conversations.length > 0}
										<span class="bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full text-xs">
											{conversations.length}
										</span>
									{/if}
								</div>
							</button>
						</nav>
					</div>

					<!-- Templates Tab -->
					{#if activeTab === 'templates'}
						<div>
							<div class="bg-gradient-to-r from-white/10 to-white/5 px-6 py-6 border-b border-white/10">
								<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
									<div>
										<h2 class="text-2xl font-bold text-white flex items-center">
											<div class="w-10 h-10 bg-gradient-to-br from-green-400 to-green-600 rounded-xl flex items-center justify-center mr-3 shadow-lg">
												<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
												</svg>
											</div>
											Hazır Cevaplar
										</h2>
										<p class="text-gray-400 text-sm mt-2">Belirlediğiniz tetikleyici kelimelerle otomatik cevap verin</p>
									</div>
									<div class="text-sm text-gray-400 bg-white/5 rounded-xl px-3 py-2 border border-white/10">
										{templates.length} şablon
									</div>
								</div>
							</div>

							<div class="p-6 border-b border-white/10 bg-white/5">
								<div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
									<div>
										<label class="block text-sm font-semibold text-gray-300 mb-3">
											<span class="flex items-center space-x-2">
												<svg class="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"/>
												</svg>
												<span>Tetikleyici Kelime</span>
											</span>
										</label>
										<input
											type="text"
											placeholder="örn: merhaba, selam, nasılsın"
											bind:value={trigger}
											class="w-full px-4 py-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all duration-300 text-lg"
										/>
									</div>
									<div>
										<label class="block text-sm font-semibold text-gray-300 mb-3">
											<span class="flex items-center space-x-2">
												<svg class="w-4 h-4 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14.828 14.828a4 4 0 01-5.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/>
												</svg>
												<span>Otomatik Cevap</span>
											</span>
										</label>
										<input
											type="text"
											placeholder="örn: Hoş geldiniz! Size nasıl yardımcı olabilirim?"
											bind:value={reply}
											class="w-full px-4 py-4 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-300 text-lg"
										/>
									</div>
								</div>
								<button
									on:click={addTemplate}
									class="w-full lg:w-auto px-8 py-4 bg-gradient-to-r from-green-500 to-green-600 hover:from-green-600 hover:to-green-700 text-white font-semibold rounded-2xl transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2 focus:ring-offset-gray-900 shadow-lg hover:shadow-xl flex items-center justify-center space-x-3 text-lg"
								>
									<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"/>
									</svg>
									<span>Yeni Şablon Ekle</span>
								</button>
							</div>

							<div class="p-6">
								{#if templates.length > 0}
									<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
										{#each templates as t, i}
											<div class="bg-white/5 backdrop-blur-sm rounded-2xl p-5 border border-white/10 hover:border-white/20 transition-all duration-300 hover:scale-105 group">
												<div class="flex items-start justify-between">
													<div class="flex-1">
														<div class="flex items-start space-x-4">
															<div class="w-3 h-3 bg-gradient-to-r from-green-400 to-green-600 rounded-full mt-2 flex-shrink-0"></div>
															<div class="flex-1 min-w-0">
																<div class="flex flex-col sm:flex-row sm:items-center space-y-2 sm:space-y-0 sm:space-x-3">
																	<span class="px-3 py-2 bg-blue-500/20 text-blue-300 rounded-xl text-sm font-semibold border border-blue-500/30">
																		{t.trigger}
																	</span>
																	<svg class="w-5 h-5 text-gray-500 hidden sm:block" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M14 5l7 7m0 0l-7 7m7-7H3"/>
																	</svg>
																	<span class="text-gray-300 text-lg font-medium truncate">{t.reply}</span>
																</div>
															</div>
														</div>
													</div>
													<button
														on:click={() => deleteTemplate(i)}
														class="opacity-0 group-hover:opacity-100 ml-4 p-3 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition-all duration-300 transform hover:scale-110 flex-shrink-0"
														title="Şablonu Sil"
													>
														<svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
														</svg>
													</button>
												</div>
											</div>
										{/each}
									</div>
								{:else}
									<div class="text-center py-12">
										<div class="w-24 h-24 bg-gradient-to-br from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
											<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
											</svg>
										</div>
										<h3 class="text-2xl font-bold text-white mb-3">Henüz şablon bulunmuyor</h3>
										<p class="text-gray-400 text-lg max-w-md mx-auto">
											İlk şablonunuzu oluşturmak için yukarıdaki formu doldurun ve otomatik cevaplamaya başlayın.
										</p>
									</div>
								{/if}
							</div>
						</div>
					{/if}

					<!-- Conversations Tab -->
					{#if activeTab === 'conversations'}
						<div>
							<div class="bg-gradient-to-r from-white/10 to-white/5 px-6 py-6 border-b border-white/10">
								<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
									<div>
										<h2 class="text-2xl font-bold text-white flex items-center">
											<div class="w-10 h-10 bg-gradient-to-br from-blue-400 to-blue-600 rounded-xl flex items-center justify-center mr-3 shadow-lg">
												<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
												</svg>
											</div>
											Geçmiş Konuşmalar
										</h2>
										<p class="text-gray-400 text-sm mt-2">Tüm WhatsApp konuşma geçmişiniz burada kayıt altında</p>
									</div>
									<div class="flex flex-col sm:flex-row gap-3">
										<div class="relative">
											<input
												type="text"
												placeholder="Konuşma ara..."
												bind:value={searchTerm}
												class="pl-10 pr-4 py-3 bg-white/5 backdrop-blur-sm border border-white/10 rounded-xl text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500/50 transition-all duration-300 w-full sm:w-64"
											/>
											<svg class="w-5 h-5 text-gray-400 absolute left-3 top-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
											</svg>
										</div>
										{#if conversations.length > 0}
											<button
												on:click={clearAllConversations}
												class="px-4 py-3 bg-red-500/20 hover:bg-red-500/30 text-red-300 rounded-xl transition-all duration-300 border border-red-500/30 hover:border-red-500/50 flex items-center space-x-2 whitespace-nowrap"
											>
												<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
													<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
												</svg>
												<span>Tümünü Temizle</span>
											</button>
										{/if}
									</div>
								</div>
							</div>

							<div class="p-6">
								{#if loadingConversations}
									<div class="text-center py-12">
										<div class="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
										<p class="text-gray-400">Konuşmalar yükleniyor...</p>
									</div>
								{:else if filteredConversations.length > 0}
									<div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
										<!-- Konuşma Listesi -->
										<div class="space-y-4">
											<h3 class="text-lg font-semibold text-white mb-4">Konuşmalar ({filteredConversations.length})</h3>
											{#each filteredConversations as conversation}
												<div
													class={`bg-white/5 backdrop-blur-sm rounded-2xl p-4 border transition-all duration-300 cursor-pointer hover:scale-105 group ${
														selectedConversation?.phone === conversation.phone
															? 'border-blue-500 bg-blue-500/10'
															: 'border-white/10 hover:border-white/20'
													}`}
													on:click={() => loadConversationDetail(conversation.phone)}
												>
													<div class="flex items-start justify-between">
														<div class="flex-1 min-w-0">
															<div class="flex items-center space-x-3 mb-2">
																<div class="w-10 h-10 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
																	<svg class="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
																	</svg>
																</div>
																<div class="flex-1 min-w-0">
																	<p class="text-white font-semibold truncate">
																		{formatPhoneNumber(conversation.phone)}
																	</p>
																	<p class="text-gray-400 text-sm truncate">
																		{conversation.lastMessage}
																	</p>
																</div>
															</div>
															<div class="flex items-center justify-between text-xs text-gray-500">
																<span>{conversation.messageCount} mesaj</span>
																<span>{formatTime(conversation.lastMessageTime)}</span>
															</div>
														</div>
														<button
															on:click={(e) => deleteConversation(conversation.phone, e)}
															class="opacity-0 group-hover:opacity-100 ml-3 p-2 text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg transition-all duration-300 transform hover:scale-110 flex-shrink-0"
															title="Konuşmayı Sil"
														>
															<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
															</svg>
														</button>
													</div>
												</div>
											{/each}
										</div>

										<!-- Seçili Konuşma Detayı -->
										<div class="bg-white/5 backdrop-blur-sm rounded-2xl border border-white/10 p-6">
											{#if selectedConversation}
												<div class="mb-6">
													<div class="flex items-center justify-between mb-4">
														<h3 class="text-lg font-semibold text-white">
															Konuşma Detayı
														</h3>
														<div class="text-sm text-gray-400 bg-white/5 rounded-lg px-3 py-1">
															{conversationHistory.length} mesaj
														</div>
													</div>
													<div class="flex items-center space-x-3 p-3 bg-white/5 rounded-xl">
														<div class="w-12 h-12 bg-gradient-to-br from-purple-500 to-blue-500 rounded-xl flex items-center justify-center flex-shrink-0">
															<svg class="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"/>
															</svg>
														</div>
														<div>
															<p class="text-white font-semibold">{formatPhoneNumber(selectedConversation.phone)}</p>
															<p class="text-gray-400 text-sm">Toplam {selectedConversation.messageCount} mesaj</p>
														</div>
													</div>
												</div>

												<div class="space-y-4 max-h-96 overflow-y-auto">
													{#each conversationHistory as message, index}
														<div class={`p-4 rounded-2xl transition-all duration-300 ${
															message.role === 'user' 
																? 'bg-blue-500/10 border border-blue-500/20 ml-8' 
																: 'bg-green-500/10 border border-green-500/20 mr-8'
														}`}>
															<div class="flex items-start space-x-3">
																<div class={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
																	message.role === 'user' 
																		? 'bg-blue-500/20' 
																		: 'bg-green-500/20'
																}`}>
																	<svg class={`w-4 h-4 ${
																		message.role === 'user' ? 'text-blue-400' : 'text-green-400'
																	}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
																		<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="{
																			message.role === 'user' 
																				? 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z'
																				: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z'
																		}"/>
																	</svg>
																</div>
																<div class="flex-1">
																	<p class="text-white text-sm mb-1">
																		{message.role === 'user' ? 'Kullanıcı' : 'Asistan'}
																	</p>
																	<p class="text-gray-300">{message.content}</p>
																</div>
															</div>
														</div>
													{/each}
												</div>
											{:else}
												<div class="text-center py-12">
													<div class="w-24 h-24 bg-gradient-to-br from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
														<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
														</svg>
													</div>
													<h3 class="text-2xl font-bold text-white mb-3">Konuşma Seçin</h3>
													<p class="text-gray-400 text-lg">
														Detaylarını görmek için soldan bir konuşma seçin
													</p>
												</div>
											{/if}
										</div>
									</div>
								{:else}
									<div class="text-center py-12">
										<div class="w-24 h-24 bg-gradient-to-br from-gray-600 to-gray-700 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg">
											<svg class="w-10 h-10 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"/>
											</svg>
										</div>
										<h3 class="text-2xl font-bold text-white mb-3">Henüz konuşma yok</h3>
										<p class="text-gray-400 text-lg max-w-md mx-auto">
											WhatsApp üzerinden gelen mesajlar burada görünecek
										</p>
									</div>
								{/if}
							</div>
						</div>
					{/if}
				</div>
			</div>

			<div class="text-center">
				<button
					on:click={logout}
					class="inline-flex items-center px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white font-semibold rounded-2xl transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 focus:ring-offset-gray-900 space-x-3 shadow-lg hover:shadow-xl text-lg"
				>
					<svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
						<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/>
					</svg>
					<span>WhatsApp Bağlantısını Kes</span>
				</button>
			</div>
		{/if}
	</main>

	<footer class="relative border-t border-white/10 mt-12 py-8">
		<div class="container mx-auto px-4 text-center">
			<p class="text-gray-500 text-sm">
				© 2024 WhatsApp Asistan
			</p>
		</div>
	</footer>
</div>

<style>
	:global(body) {
		margin: 0;
		padding: 0;
		background: linear-gradient(135deg, #111827 0%, #1f2937 50%, #111827 100%);
		font-family: 'Inter', system-ui, -apple-system, sans-serif;
	}

	:global(::-webkit-scrollbar) {
		width: 8px;
	}

	:global(::-webkit-scrollbar-track) {
		background: rgba(255, 255, 255, 0.05);
	}

	:global(::-webkit-scrollbar-thumb) {
		background: rgba(255, 255, 255, 0.2);
		border-radius: 4px;
	}

	:global(::-webkit-scrollbar-thumb:hover) {
		background: rgba(255, 255, 255, 0.3);
	}
</style>