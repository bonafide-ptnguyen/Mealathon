import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, addDoc, setDoc, updateDoc, deleteDoc, onSnapshot, collection, query, where, getDocs, serverTimestamp } from 'firebase/firestore';

// Your web app's Firebase configuration - now loaded from environment variables
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID
};

// For local testing, using projectId as appId and no initial auth token
const appId = firebaseConfig.projectId; // This should match your Firebase project ID
const initialAuthToken = null; // No initial token for local anonymous sign-in

// Create a context for Firebase and User data
const AppContext = createContext(null);

// Custom Modal Component
const Modal = ({ show, title, message, onClose, onConfirm, showConfirmButton = false }) => {
    if (!show) return null;

    return (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full">
                <h3 className="text-xl font-semibold text-gray-800 mb-4">{title}</h3>
                <p className="text-gray-600 mb-6">{message}</p>
                <div className="flex justify-end space-x-3">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                    >
                        Close
                    </button>
                    {showConfirmButton && (
                        <button
                            onClick={onConfirm}
                            className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors duration-200"
                        >
                            Confirm
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

// Campaign Card Component
const CampaignCard = ({ campaign, onClick }) => {
    const progress = (campaign.totalDonations / (campaign.targetAmount || 1)) * 100;
    const mealsPossible = campaign.costPerMeal > 0 ? Math.floor(campaign.totalDonations / campaign.costPerMeal) : 0;
    const endDate = campaign.endDate ? new Date(campaign.endDate.seconds * 1000).toLocaleDateString() : 'N/A';

    return (
        <div
            className="bg-white rounded-xl shadow-lg p-6 mb-6 cursor-pointer hover:shadow-xl transition-shadow duration-300 border border-gray-200"
            onClick={() => onClick(campaign)}
        >
            <h3 className="text-2xl font-bold text-gray-800 mb-2">{campaign.campaignName}</h3>
            <p className="text-gray-600 text-lg mb-3">by <span className="font-semibold">{campaign.restaurantName}</span></p>
            <p className="text-gray-700 mb-2">
                <span className="font-medium">Donated:</span> ${campaign.totalDonations ? campaign.totalDonations.toFixed(2) : '0.00'}
            </p>
            <p className="text-gray-700 mb-2">
                <span className="font-medium">Meals Possible:</span> {mealsPossible}
            </p>
            <p className="text-gray-700 mb-4">
                <span className="font-medium">Ends:</span> {endDate}
            </p>
            <div className="w-full bg-gray-200 rounded-full h-2.5">
                <div
                    className="bg-green-500 h-2.5 rounded-full"
                    style={{ width: `${Math.min(100, progress)}%` }}
                ></div>
            </div>
            {campaign.targetAmount && (
                <p className="text-sm text-gray-500 mt-2">Target: ${campaign.targetAmount.toFixed(2)}</p>
            )}
        </div>
    );
};

// Campaign List Component
const CampaignList = ({ onSelectCampaign, onCreateCampaign }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!db || !isAuthReady) {
            console.log("CampaignList: DB not ready or Auth not ready. Skipping fetch.");
            return;
        }
        console.log("CampaignList: Attempting to fetch campaigns with userId:", userId, "and appId:", appId);

        const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
        const q = query(campaignsCollectionRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedCampaigns = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setCampaigns(fetchedCampaigns);
            setLoading(false);
            console.log("CampaignList: Successfully fetched", fetchedCampaigns.length, "campaigns.");
        }, (error) => {
            console.error("Error fetching campaigns:", error);
            showModal('Error', 'Failed to load campaigns. Please try again later.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, isAuthReady, showModal, userId]); // Added userId to dependencies for better logging

    if (loading) {
        return <div className="text-center text-gray-600">Loading campaigns...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Active Campaigns</h2>
            <div className="flex justify-center mb-8">
                <button
                    onClick={onCreateCampaign}
                    className="bg-gradient-to-r from-blue-500 to-blue-600 text-white px-8 py-3 rounded-full shadow-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-blue-300"
                >
                    + Create New Campaign
                </button>
            </div>
            {campaigns.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">No active campaigns found. Be the first to create one!</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {campaigns.map(campaign => (
                        <CampaignCard key={campaign.id} campaign={campaign} onClick={onSelectCampaign} />
                    ))}
                </div>
            )}
        </div>
    );
};

// Campaign Detail Component
const CampaignDetail = ({ campaign, onBack }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [donationAmount, setDonationAmount] = useState('');
    const [loading, setLoading] = useState(false);

    const handleDonate = async () => {
        if (!donationAmount || parseFloat(donationAmount) <= 0) {
            showModal('Invalid Amount', 'Please enter a valid donation amount.');
            return;
        }

        if (!campaign || !campaign.id) {
            showModal('Error', 'Campaign data is missing.');
            return;
        }

        setLoading(true);
        try {
            const amount = parseFloat(donationAmount);
            const donationsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/donations`);
            const campaignDocRef = doc(db, `artifacts/${appId}/public/data/campaigns`, campaign.id);

            await addDoc(donationsCollectionRef, {
                campaignId: campaign.id,
                donorId: userId,
                amount: amount,
                timestamp: serverTimestamp(),
            });

            // Update totalDonations in the campaign document
            const campaignSnap = await getDoc(campaignDocRef);
            if (campaignSnap.exists()) {
                const currentTotal = campaignSnap.data().totalDonations || 0;
                await updateDoc(campaignDocRef, {
                    totalDonations: currentTotal + amount
                });
            } else {
                console.warn("Campaign document not found for update:", campaign.id);
            }

            showModal('Success', `Thank you for your donation of $${amount.toFixed(2)} to ${campaign.campaignName}!`);
            setDonationAmount('');
        } catch (error) {
            console.error("Error making donation:", error);
            showModal('Error', 'Failed to process your donation. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const mealsPossible = campaign.costPerMeal > 0 ? Math.floor(campaign.totalDonations / campaign.costPerMeal) : 0;
    const endDate = campaign.endDate ? new Date(campaign.endDate.seconds * 1000).toLocaleDateString() : 'N/A';

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Campaigns
            </button>

            <div className="max-w-3xl mx-auto bg-white rounded-xl shadow-lg p-8 border border-gray-200">
                <h2 className="text-4xl font-extrabold text-gray-900 mb-4">{campaign.campaignName}</h2>
                <p className="text-gray-600 text-xl mb-4">by <span className="font-semibold">{campaign.restaurantName}</span></p>
                <p className="text-gray-700 text-lg mb-6 leading-relaxed">{campaign.description}</p>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
                    <div>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Cost per Meal:</span> ${campaign.costPerMeal ? campaign.costPerMeal.toFixed(2) : '0.00'}</p>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Campaign Ends:</span> {endDate}</p>
                    </div>
                    <div>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Total Donated:</span> ${campaign.totalDonations ? campaign.totalDonations.toFixed(2) : '0.00'}</p>
                        <p className="text-gray-700 text-lg"><span className="font-medium">Estimated Meals:</span> {mealsPossible}</p>
                    </div>
                </div>

                <h3 className="text-2xl font-bold text-gray-800 mb-4">Distribution Updates</h3>
                {campaign.distributionUpdates && campaign.distributionUpdates.length > 0 ? (
                    <ul className="list-disc list-inside text-gray-700 mb-8">
                        {campaign.distributionUpdates.map((update, index) => (
                            <li key={index} className="mb-2">
                                <span className="font-semibold">{new Date(update.date.seconds * 1000).toLocaleDateString()}:</span> {update.message}
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className="text-gray-600 mb-8">No distribution updates yet. Check back after the campaign ends!</p>
                )}

                <div className="border-t border-gray-200 pt-6">
                    <h3 className="text-2xl font-bold text-gray-800 mb-4">Make a Donation</h3>
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
                        <input
                            type="number"
                            placeholder="Amount to donate"
                            value={donationAmount}
                            onChange={(e) => setDonationAmount(e.target.value)}
                            className="flex-grow p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            min="0.01"
                            step="0.01"
                        />
                        <button
                            onClick={handleDonate}
                            disabled={loading}
                            className="w-full sm:w-auto bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-md shadow-md hover:from-green-600 hover:to-green-700 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-green-300 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {loading ? 'Processing...' : 'Donate Now'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

// Create Campaign Component
const CreateCampaign = ({ onBack }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [campaignName, setCampaignName] = useState('');
    const [restaurantName, setRestaurantName] = useState('');
    const [costPerMeal, setCostPerMeal] = useState('');
    const [endDate, setEndDate] = useState('');
    const [description, setDescription] = useState('');
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!campaignName || !restaurantName || !costPerMeal || !endDate || !description) {
            showModal('Missing Information', 'Please fill in all fields.');
            return;
        }
        if (parseFloat(costPerMeal) <= 0) {
            showModal('Invalid Cost', 'Cost per meal must be greater than zero.');
            return;
        }
        const campaignEndDate = new Date(endDate);
        if (isNaN(campaignEndDate.getTime()) || campaignEndDate < new Date()) {
            showModal('Invalid Date', 'Please select a future end date.');
            return;
        }

        setLoading(true);
        try {
            const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
            await addDoc(campaignsCollectionRef, {
                campaignName,
                restaurantName,
                costPerMeal: parseFloat(costPerMeal),
                endDate: campaignEndDate, // Store as Date object, Firestore converts to Timestamp
                description,
                totalDonations: 0,
                totalMealsProvided: 0,
                distributionUpdates: [],
                status: 'active',
                providerId: userId,
                createdAt: serverTimestamp(),
            });
            showModal('Success', 'Campaign created successfully!');
            onBack(); // Go back to campaign list
        } catch (error) {
            console.error("Error creating campaign:", error);
            showModal('Error', 'Failed to create campaign. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Campaigns
            </button>
            <div className="max-w-2xl mx-auto bg-white rounded-xl shadow-lg p-8 border border-gray-200">
                <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Create New Campaign</h2>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label htmlFor="campaignName" className="block text-lg font-medium text-gray-700 mb-1">Campaign Name</label>
                        <input
                            type="text"
                            id="campaignName"
                            value={campaignName}
                            onChange={(e) => setCampaignName(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            placeholder="e.g., Feed Our Community Heroes"
                        />
                    </div>
                    <div>
                        <label htmlFor="restaurantName" className="block text-lg font-medium text-gray-700 mb-1">Restaurant/Provider Name</label>
                        <input
                            type="text"
                            id="restaurantName"
                            value={restaurantName}
                            onChange={(e) => setRestaurantName(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            placeholder="e.g., Delicious Bites Diner"
                        />
                    </div>
                    <div>
                        <label htmlFor="costPerMeal" className="block text-lg font-medium text-gray-700 mb-1">Cost Per Meal ($)</label>
                        <input
                            type="number"
                            id="costPerMeal"
                            value={costPerMeal}
                            onChange={(e) => setCostPerMeal(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            min="0.01"
                            step="0.01"
                            placeholder="e.g., 5.50"
                        />
                    </div>
                    <div>
                        <label htmlFor="endDate" className="block text-lg font-medium text-gray-700 mb-1">Campaign End Date</label>
                        <input
                            type="date"
                            id="endDate"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                        />
                    </div>
                    <div>
                        <label htmlFor="description" className="block text-lg font-medium text-gray-700 mb-1">Description</label>
                        <textarea
                            id="description"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            rows="5"
                            className="w-full p-3 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500 text-lg"
                            placeholder="Tell us about your campaign and why it matters..."
                        ></textarea>
                    </div>
                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full bg-gradient-to-r from-green-500 to-green-600 text-white px-6 py-3 rounded-md shadow-md hover:from-green-600 hover:to-green-700 transition-all duration-300 transform hover:scale-105 focus:outline-none focus:ring-4 focus:ring-green-300 disabled:opacity-50 disabled:cursor-not-allowed text-lg font-semibold"
                    >
                        {loading ? 'Creating...' : 'Create Campaign'}
                    </button>
                </form>
            </div>
        </div>
    );
};

// Provider Dashboard Component
const ProviderDashboard = ({ onBack }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [myCampaigns, setMyCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedCampaignToManage, setSelectedCampaignToManage] = useState(null);
    const [newUpdateMessage, setNewUpdateMessage] = useState('');

    useEffect(() => {
        if (!db || !isAuthReady || !userId) {
            console.log("ProviderDashboard: DB not ready, Auth not ready, or userId is null. Skipping fetch.");
            return;
        }
        console.log("ProviderDashboard: Attempting to fetch campaigns for providerId:", userId, "and appId:", appId);

        const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
        const q = query(campaignsCollectionRef, where("providerId", "==", userId));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedCampaigns = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setMyCampaigns(fetchedCampaigns);
            setLoading(false);
            console.log("ProviderDashboard: Successfully fetched", fetchedCampaigns.length, "campaigns for providerId:", userId);
        }, (error) => {
            console.error("Error fetching provider campaigns:", error);
            showModal('Error', 'Failed to load your campaigns. Please try again later.');
            setLoading(false);
        });

        return () => unsubscribe();
    }, [db, isAuthReady, userId, showModal]);

    const handleUpdateDistribution = async () => {
        if (!selectedCampaignToManage || !newUpdateMessage.trim()) {
            showModal('Missing Info', 'Please select a campaign and enter an update message.');
            return;
        }

        setLoading(true);
        try {
            const campaignDocRef = doc(db, `artifacts/${appId}/public/data/campaigns`, selectedCampaignToManage.id);
            const currentUpdates = selectedCampaignToManage.distributionUpdates || [];
            // FIX: Use new Date() instead of serverTimestamp() directly in array elements
            const updatedUpdates = [...currentUpdates, { message: newUpdateMessage.trim(), date: new Date() }];

            await updateDoc(campaignDocRef, {
                distributionUpdates: updatedUpdates,
                totalMealsProvided: selectedCampaignToManage.costPerMeal > 0 ? Math.floor(selectedCampaignToManage.totalDonations / selectedCampaignToManage.costPerMeal) : 0,
                status: 'distributed' // Mark as distributed once an update is added
            });

            showModal('Success', 'Distribution update added successfully!');
            setNewUpdateMessage('');
            setSelectedCampaignToManage(prev => ({
                ...prev,
                distributionUpdates: updatedUpdates,
                totalMealsProvided: prev.costPerMeal > 0 ? Math.floor(prev.totalDonations / prev.costPerMeal) : 0,
                status: 'distributed'
            }));
        } catch (error) {
            console.error("Error updating distribution:", error);
            showModal('Error', 'Failed to update distribution. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    if (loading) {
        return <div className="text-center text-gray-600">Loading your campaigns...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Home
            </button>

            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Your Campaigns</h2>

            {myCampaigns.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">You haven't created any campaigns yet.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {myCampaigns.map(campaign => (
                        <div key={campaign.id} className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                            <h3 className="text-2xl font-bold text-gray-800 mb-2">{campaign.campaignName}</h3>
                            <p className="text-gray-600 text-lg mb-3">by <span className="font-semibold">{campaign.restaurantName}</span></p>
                            <p className="text-gray-700 mb-2">
                                <span className="font-medium">Total Donated:</span> ${campaign.totalDonations ? campaign.totalDonations.toFixed(2) : '0.00'}
                            </p>
                            <p className="text-gray-700 mb-4">
                                <span className="font-medium">Meals Provided:</span> {campaign.totalMealsProvided || 0}
                            </p>
                            <p className="text-gray-700 mb-4">
                                <span className="font-medium">Status:</span> {campaign.status}
                            </p>
                            <button
                                onClick={() => setSelectedCampaignToManage(campaign)}
                                className="w-full bg-blue-500 text-white px-4 py-2 rounded-md hover:bg-blue-600 transition-colors duration-200"
                            >
                                Manage Campaign
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {selectedCampaignToManage && (
                <div className="fixed inset-0 bg-gray-600 bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-lg shadow-xl p-6 max-w-lg w-full">
                        <h3 className="text-2xl font-semibold text-gray-800 mb-4">Manage "{selectedCampaignToManage.campaignName}"</h3>
                        <p className="text-gray-700 mb-2">
                            <span className="font-medium">Total Donated:</span> ${selectedCampaignToManage.totalDonations ? selectedCampaignToManage.totalDonations.toFixed(2) : '0.00'}
                        </p>
                        <p className="text-gray-700 mb-4">
                            <span className="font-medium">Estimated Meals Possible:</span> {selectedCampaignToManage.costPerMeal > 0 ? Math.floor(selectedCampaignToManage.totalDonations / selectedCampaignToManage.costPerMeal) : 0}
                        </p>

                        <h4 className="text-xl font-semibold text-gray-800 mb-3">Add Distribution Update</h4>
                        <textarea
                            className="w-full p-3 border border-gray-300 rounded-md mb-4 focus:ring-blue-500 focus:border-blue-500"
                            rows="4"
                            placeholder="e.g., '500 meals delivered to local shelters on 2025-07-01.'"
                            value={newUpdateMessage}
                            onChange={(e) => setNewUpdateMessage(e.target.value)}
                        ></textarea>
                        <div className="flex justify-end space-x-3">
                            <button
                                onClick={() => { setSelectedCampaignToManage(null); setNewUpdateMessage(''); }}
                                className="px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleUpdateDistribution}
                                disabled={loading}
                                className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {loading ? 'Updating...' : 'Submit Update'}
                            </button>
                        </div>

                        <h4 className="text-xl font-semibold text-gray-800 mt-6 mb-3">Past Updates</h4>
                        {selectedCampaignToManage.distributionUpdates && selectedCampaignToManage.distributionUpdates.length > 0 ? (
                            <ul className="list-disc list-inside text-gray-700 max-h-40 overflow-y-auto">
                                {selectedCampaignToManage.distributionUpdates.map((update, index) => (
                                    <li key={index} className="mb-1">
                                        <span className="font-semibold">{new Date(update.date.seconds * 1000).toLocaleDateString()}:</span> {update.message}
                                    </li>
                                ))}
                            </ul>
                        ) : (
                            <p className="text-gray-600">No updates posted yet.</p>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// Donor Dashboard Component
const DonorDashboard = ({ onBack }) => {
    const { db, auth, userId, isAuthReady, showModal } = useContext(AppContext);
    const [myDonations, setMyDonations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [campaignsMap, setCampaignsMap] = useState({}); // To store campaign names by ID

    useEffect(() => {
        if (!db || !isAuthReady || !userId) {
            console.log("DonorDashboard: DB not ready, Auth not ready, or userId is null. Skipping fetch.");
            return;
        }
        console.log("DonorDashboard: Attempting to fetch donations for userId:", userId);

        const fetchDonations = async () => {
            try {
                // Fetch all campaigns to map IDs to names
                const campaignsCollectionRef = collection(db, `artifacts/${appId}/public/data/campaigns`);
                const campaignSnapshot = await getDocs(campaignsCollectionRef);
                const campaignsData = {};
                campaignSnapshot.docs.forEach(doc => {
                    campaignsData[doc.id] = doc.data().campaignName;
                });
                setCampaignsMap(campaignsData);
                console.log("DonorDashboard: Fetched campaign names map.");

                // Fetch user-specific donations
                const donationsCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/donations`);
                const q = query(donationsCollectionRef);

                const unsubscribe = onSnapshot(q, (snapshot) => {
                    const fetchedDonations = snapshot.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    setMyDonations(fetchedDonations);
                    setLoading(false);
                    console.log("DonorDashboard: Successfully fetched", fetchedDonations.length, "donations for userId:", userId);
                }, (error) => {
                    console.error("Error fetching donor donations:", error);
                    showModal('Error', 'Failed to load your donations. Please try again later.');
                    setLoading(false);
                });

                return () => unsubscribe();
            } catch (error) {
                console.error("Error in donor dashboard useEffect:", error);
                showModal('Error', 'An error occurred while loading your data.');
                setLoading(false);
            }
        };

        fetchDonations();
    }, [db, isAuthReady, userId, showModal]);

    if (loading) {
        return <div className="text-center text-gray-600">Loading your donations...</div>;
    }

    return (
        <div className="p-6 bg-gray-50 min-h-screen">
            <button
                onClick={onBack}
                className="mb-6 px-4 py-2 bg-gray-200 text-gray-800 rounded-md hover:bg-gray-300 transition-colors duration-200 flex items-center"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                </svg>
                Back to Home
            </button>

            <h2 className="text-4xl font-extrabold text-gray-900 mb-8 text-center">Your Donations</h2>

            {myDonations.length === 0 ? (
                <p className="text-center text-gray-600 text-lg">You haven't made any donations yet.</p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 max-w-6xl mx-auto">
                    {myDonations.map(donation => (
                        <div key={donation.id} className="bg-white rounded-xl shadow-lg p-6 border border-gray-200">
                            <h3 className="text-2xl font-bold text-gray-800 mb-2">
                                {campaignsMap[donation.campaignId] || 'Unknown Campaign'}
                            </h3>
                            <p className="text-gray-700 mb-2">
                                <span className="font-medium">Amount:</span> ${donation.amount ? donation.amount.toFixed(2) : '0.00'}
                            </p>
                            <p className="text-gray-700 mb-4">
                                <span className="font-medium">Date:</span> {donation.timestamp ? new Date(donation.timestamp.seconds * 1000).toLocaleDateString() : 'N/A'}
                            </p>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};


// Main App Component
const App = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);
    const [view, setView] = useState('home'); // 'home', 'campaign-detail', 'create-campaign', 'provider-dashboard', 'donor-dashboard'
    const [selectedCampaign, setSelectedCampaign] = useState(null);

    // Modal state
    const [showModal, setShowModal] = useState(false);
    const [modalTitle, setModalTitle] = useState('');
    const [modalMessage, setModalMessage] = useState('');
    const [modalShowConfirm, setModalShowConfirm] = useState(false);
    const [modalConfirmAction, setModalConfirmAction] = useState(null);

    const handleShowModal = (title, message, showConfirm = false, onConfirm = null) => {
        setModalTitle(title);
        setModalMessage(message);
        setModalShowConfirm(showConfirm);
        setModalConfirmAction(() => onConfirm); // Use a function to set state
        setShowModal(true);
    };

    const handleCloseModal = () => {
        setShowModal(false);
        setModalTitle('');
        setModalMessage('');
        setModalShowConfirm(false);
        setModalConfirmAction(null);
    };

    const handleConfirmModal = () => {
        if (modalConfirmAction) {
            modalConfirmAction();
        }
        handleCloseModal();
    };

    useEffect(() => {
        try {
            const app = initializeApp(firebaseConfig);
            const firestore = getFirestore(app);
            const firebaseAuth = getAuth(app);

            setDb(firestore);
            setAuth(firebaseAuth);
            console.log("Firebase initialized.");

            // Sign in with custom token or anonymously
            const signIn = async () => {
                try {
                    if (initialAuthToken) {
                        await signInWithCustomToken(firebaseAuth, initialAuthToken);
                        console.log("Signed in with custom token.");
                    } else {
                        await signInAnonymously(firebaseAuth);
                        console.log("Signed in anonymously.");
                    }
                } catch (error) {
                    console.error("Firebase authentication error:", error);
                    handleShowModal('Authentication Error', 'Failed to authenticate with Firebase. Please refresh the page.');
                }
            };
            signIn();

            // Listen for auth state changes
            const unsubscribeAuth = onAuthStateChanged(firebaseAuth, (user) => {
                if (user) {
                    setUserId(user.uid);
                    console.log("Auth State Changed: User is logged in. UID:", user.uid);
                } else {
                    const newUserId = crypto.randomUUID();
                    setUserId(newUserId);
                    console.log("Auth State Changed: User is NOT logged in. Using anonymous ID:", newUserId);
                }
                setIsAuthReady(true); // Auth state is ready
                console.log("isAuthReady set to true.");
            });

            return () => unsubscribeAuth();
        } catch (error) {
            console.error("Error initializing Firebase:", error);
            handleShowModal('Initialization Error', 'Failed to initialize Firebase. Please check your configuration.');
        }
    }, []);

    const handleSelectCampaign = (campaign) => {
        setSelectedCampaign(campaign);
        setView('campaign-detail');
    };

    const handleBackToHome = () => {
        setSelectedCampaign(null);
        setView('home');
    };

    const handleCreateCampaignClick = () => {
        setView('create-campaign');
    };

    const handleGoToProviderDashboard = () => {
        setView('provider-dashboard');
    };

    const handleGoToDonorDashboard = () => {
        setView('donor-dashboard');
    };

    if (!isAuthReady) {
        return (
            <div className="flex items-center justify-center min-h-screen bg-gray-100">
                <div className="text-xl text-gray-700">Loading application...</div>
            </div>
        );
    }

    return (
        <AppContext.Provider value={{ db, auth, userId, isAuthReady, showModal: handleShowModal }}>
            <div className="font-sans antialiased bg-gray-100 text-gray-900">
                <header className="bg-white shadow-md p-4 flex justify-between items-center">
                    <div className="flex items-center"> {/* Flex container for logo and title */}
                        {/* SVG Logo for Mealathon */}
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="h-8 w-8 text-blue-500 mr-2" // Tailwind classes for size and color
                        >
                            <path
                                fillRule="evenodd"
                                d="M11.47 2.47a.75.75 0 0 1 1.06 0l3.75 3.75a.75.75 0 0 1-1.06 1.06L12 4.06V16.5a.75.75 0 0 1-1.5 0V4.06L8.78 7.28a.75.75 0 0 1-1.06-1.06l3.75-3.75Z"
                                clipRule="evenodd"
                            />
                            <path
                                fillRule="evenodd"
                                d="M2.25 13.5a.75.75 0 0 1 .75.75V19.5a3 3 0 0 0 3 3h12a3 3 0 0 0 3-3v-5.25a.75.75 0 0 1 1.5 0V19.5a4.5 4.5 0 0 1-4.5 4.5H6a4.5 4.5 0 0 1-4.5-4.5V14.25a.75.75 0 0 1 .75-.75Z"
                                clipRule="evenodd"
                            />
                        </svg>
                        <h1 className="text-3xl font-extrabold text-blue-700">Mealathon</h1>
                    </div>
                    <nav className="space-x-4">
                        <button
                            onClick={handleBackToHome}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            Home
                        </button>
                        <button
                            onClick={handleGoToProviderDashboard}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            My Campaigns
                        </button>
                        <button
                            onClick={handleGoToDonorDashboard}
                            className="text-gray-700 hover:text-blue-600 font-medium px-3 py-2 rounded-md transition-colors duration-200"
                        >
                            My Donations
                        </button>
                    </nav>
                </header>

                <main>
                    {view === 'home' && (
                        <CampaignList
                            onSelectCampaign={handleSelectCampaign}
                            onCreateCampaign={handleCreateCampaignClick}
                        />
                    )}
                    {view === 'campaign-detail' && selectedCampaign && (
                        <CampaignDetail campaign={selectedCampaign} onBack={handleBackToHome} />
                    )}
                    {view === 'create-campaign' && (
                        <CreateCampaign onBack={handleBackToHome} />
                    )}
                    {view === 'provider-dashboard' && (
                        <ProviderDashboard onBack={handleBackToHome} />
                    )}
                    {view === 'donor-dashboard' && (
                        <DonorDashboard onBack={handleBackToHome} />
                    )}
                </main>

                <Modal
                    show={showModal}
                    title={modalTitle}
                    message={modalMessage}
                    onClose={handleCloseModal}
                    onConfirm={handleConfirmModal}
                    showConfirmButton={modalShowConfirm}
                />

                <footer className="bg-gray-800 text-white p-4 text-center text-sm">
                    <p>Mealathon App - Connecting Food Providers with Communities. Your User ID: <span className="font-mono text-blue-300">{userId}</span></p>
                </footer>
            </div>
        </AppContext.Provider>
    );
};

export default App;
