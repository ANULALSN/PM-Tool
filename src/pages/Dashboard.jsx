import React, { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { collection, addDoc, onSnapshot, query, where, serverTimestamp, doc, deleteDoc, getDocs, orderBy } from "firebase/firestore"; // Added orderBy here
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth"; 

function Dashboard() {
  const { user, role, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  // State for team management
  const [allUsers, setAllUsers] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [teams, setTeams] = useState([]); // For managers
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedDevs, setSelectedDevs] = useState([]);
  const [showTeamModal, setShowTeamModal] = useState(false);

  // State for messaging
  const [messages, setMessages] = useState([]);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [recipient, setRecipient] = useState("");


  // Effect to fetch user-specific data (projects, teams, messages)
  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    };
    
    // Query for projects created by the user
    const projectsQuery = query(collection(db, "projects"), where("creatorId", "==", user.uid));
    const unsubProjects = onSnapshot(projectsQuery, (snapshot) => {
      setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });

    // Query for teams the user is a member of
    const myTeamsQuery = query(collection(db, "teams"), where("members", "array-contains", user.email));
    const unsubMyTeams = onSnapshot(myTeamsQuery, (snapshot) => {
        setMyTeams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    // Query for messages sent to the user
    const messagesQuery = query(collection(db, "messages"), where("recipientEmail", "==", user.email), orderBy("createdAt", "desc"));
    const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
        setMessages(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
        unsubProjects();
        unsubMyTeams();
        unsubMessages();
    };
  }, [user]);

  // Effect to fetch manager-specific data (all developers, all teams)
  useEffect(() => {
    if (role === 'manager' || role === 'admin') {
      const usersQuery = query(collection(db, "users"));
      const unsubUsers = onSnapshot(usersQuery, (snapshot) => {
        setAllUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });

      const teamsQuery = query(collection(db, "teams"));
      const unsubTeams = onSnapshot(teamsQuery, (snapshot) => {
        setTeams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });

      return () => {
        unsubUsers();
        unsubTeams();
      };
    }
  }, [role]);

  // Project Handlers
  const handleAddProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim() || !user) return;
    await addDoc(collection(db, "projects"), { name: newProjectName, creatorId: user.uid, creatorEmail: user.email, createdAt: serverTimestamp() });
    setNewProjectName("");
  };
  const handleDeleteProject = async (projectId) => await deleteDoc(doc(db, "projects", projectId));

  // Team Handlers
  const handleCreateTeam = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim() || selectedDevs.length === 0) {
      setError("Team name and at least one member are required.");
      return;
    }
    await addDoc(collection(db, "teams"), { name: newTeamName, members: selectedDevs, managerId: user.uid });
    setNewTeamName("");
    setSelectedDevs([]);
    setShowTeamModal(false);
    setError("");
  };
  const handleDevSelection = (devEmail) => setSelectedDevs(prev => prev.includes(devEmail) ? prev.filter(email => email !== devEmail) : [...prev, devEmail]);

  // Message Handler
  const handleSendMessage = async (e) => {
      e.preventDefault();
      if (!newMessage.trim() || !recipient) {
          setError("Please select a recipient and write a message.");
          return;
      }
      await addDoc(collection(db, "messages"), {
          text: newMessage,
          senderEmail: user.email,
          recipientEmail: recipient,
          createdAt: serverTimestamp(),
      });
      setNewMessage("");
      setRecipient("");
      setShowMessagesModal(false);
      setError("");
  };

  if (loading || authLoading) return <div className="text-center mt-12 text-primary">Loading...</div>;

  const developers = allUsers.filter(u => u.role === 'developer');

  return (
    <div className="min-h-screen bg-secondary-grey">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <h1 className="text-4xl font-bold text-primary mb-8">Dashboard</h1>
        
        {/* --- Manager/Admin Section --- */}
        {(role === 'manager' || role === 'admin') && (
          <>
            <div className="bg-white p-6 rounded-lg shadow-md mb-8">
              <h2 className="text-2xl font-semibold text-primary mb-4">Project Management</h2>
              <form onSubmit={handleAddProject} className="flex flex-col sm:flex-row gap-4">
                <input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Enter a new project name..." className="flex-grow p-3 border rounded-md focus:ring-2 focus:ring-primary"/>
                <button type="submit" className="px-6 py-3 bg-primary text-white font-semibold rounded-md hover:bg-opacity-90">Add Project</button>
              </form>
              {error && <p className="mt-4 text-accent-red">{error}</p>}
            </div>

            <div className="bg-white p-6 rounded-lg shadow-md mb-8">
              <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold text-primary">Team Management</h2>
                <button onClick={() => setShowTeamModal(true)} className="px-4 py-2 bg-accent-teal text-white font-semibold rounded-md hover:bg-opacity-90">Create Team</button>
              </div>
              <div className="mt-4 space-y-2">
                {teams.map(team => (
                  <div key={team.id} className="p-3 border rounded-md">
                    <p className="font-bold text-primary">{team.name}</p>
                    <p className="text-sm text-gray-500">Members: {team.members.join(', ')}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* --- My Teams Section (for all users) --- */}
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <h2 className="text-2xl font-semibold text-primary">My Teams</h2>
            <div className="mt-4 space-y-2">
                {myTeams.length > 0 ? myTeams.map(team => (
                    <div key={team.id} className="p-3 bg-secondary-blue bg-opacity-20 rounded-md">
                        <p className="font-bold text-primary">{team.name}</p>
                    </div>
                )) : (
                    <p className="text-gray-500">You are not a member of any teams yet.</p>
                )}
            </div>
        </div>

        {/* --- Messaging Section --- */}
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-semibold text-primary">Inbox</h2>
                <button onClick={() => setShowMessagesModal(true)} className="px-4 py-2 bg-accent-teal text-white font-semibold rounded-md hover:bg-opacity-90">Send Message</button>
            </div>
            <div className="mt-4 space-y-3 max-h-60 overflow-y-auto">
                {messages.length > 0 ? messages.map(msg => (
                    <div key={msg.id} className="p-3 bg-secondary-blue bg-opacity-40 border-l-4 border-primary rounded-r-md">
                        <p className="text-sm text-gray-600">From: <span className="font-semibold">{msg.senderEmail}</span></p>
                        <p className="text-primary mt-1">{msg.text}</p>
                        <p className="text-xs text-gray-400 text-right mt-2">{msg.createdAt?.toDate().toLocaleString()}</p>
                    </div>
                )) : (
                    <p className="text-gray-500">You have no new messages.</p>
                )}
            </div>
        </div>

        {/* --- My Projects Section --- */}
        <div>
          <h2 className="text-2xl font-semibold text-primary mb-4">My Projects</h2>
          {projects.length > 0 ? (
            <div className="space-y-4">
              {projects.map((project) => (
                <div key={project.id} className="group relative block bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow overflow-hidden">
                   <Link to={`/project/${project.id}`} className="block p-6">
                     <div className="relative inline-block text-xl font-semibold text-primary after:absolute after:bottom-[-2px] after:left-0 after:h-[2px] after:w-full after:bg-accent-teal after:scale-x-0 after:origin-left after:transition-transform group-hover:after:scale-x-100">{project.name}</div>
                    <p className="text-sm text-gray-500 mt-1">Created on: {project.createdAt?.toDate().toLocaleDateString() || 'N/A'}</p>
                   </Link>
                   <button onClick={(e) => { e.preventDefault(); handleDeleteProject(project.id); }} className="absolute top-0 right-0 h-full px-5 bg-accent-red text-white flex items-center justify-center transform translate-x-full group-hover:translate-x-0 transition-transform">Delete</button>
                </div>
              ))}
            </div>
          ) : (
            <div className="bg-white p-6 rounded-lg shadow-md text-center text-gray-500"><p>You have not created any projects yet.</p></div>
          )}
        </div>

        {/* --- Modals --- */}
        {showTeamModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
              <h3 className="text-2xl font-bold text-primary mb-4">Create a New Team</h3>
              <form onSubmit={handleCreateTeam}>
                <input type="text" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team Name" className="w-full p-2 mb-4 border rounded-md"/>
                <div className="mb-4">
                  <p className="font-semibold mb-2">Select Team Members</p>
                  <div className="max-h-40 overflow-y-auto space-y-2">
                    {developers.map(dev => (
                      <label key={dev.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary-grey cursor-pointer">
                        <input type="checkbox" checked={selectedDevs.includes(dev.email)} onChange={() => handleDevSelection(dev.email)} className="h-4 w-4 rounded text-primary focus:ring-primary"/>
                        {dev.email}
                      </label>
                    ))}
                  </div>
                </div>
                <div className="flex justify-end gap-4">
                  <button type="button" onClick={() => setShowTeamModal(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cancel</button>
                  <button type="submit" className="px-4 py-2 bg-primary text-white rounded-md">Create</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {showMessagesModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
                <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
                    <h3 className="text-2xl font-bold text-primary mb-4">Send a Message</h3>
                    <form onSubmit={handleSendMessage}>
                        <div className="mb-4">
                            <label htmlFor="recipient" className="block text-sm font-medium text-gray-700 mb-1">Recipient</label>
                            <select id="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full p-2 border rounded-md">
                                <option value="">Select a user...</option>
                                {allUsers.map(u => <option key={u.id} value={u.email}>{u.email}</option>)}
                            </select>
                        </div>
                        <textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Your message..." className="w-full p-2 mb-4 border rounded-md h-28"/>
                        <div className="flex justify-end gap-4">
                            <button type="button" onClick={() => setShowMessagesModal(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cancel</button>
                            <button type="submit" className="px-4 py-2 bg-primary text-white rounded-md">Send</button>
                        </div>
                    </form>
                </div>
            </div>
        )}
      </div>
    </div>
  );
}

export default Dashboard;
