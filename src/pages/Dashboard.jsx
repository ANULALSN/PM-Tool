import React, { useState, useEffect } from "react";
import { auth, db } from "../firebase";
import { collection, addDoc, onSnapshot, query, where, serverTimestamp, doc, deleteDoc, updateDoc, writeBatch, getDocs, orderBy } from "firebase/firestore";
import { Link } from "react-router-dom";
import { useAuth } from "../hooks/useAuth"; 

// --- Project Card Component with Task Count ---
function ProjectCard({ project, role, onDelete }) {
    const [taskCount, setTaskCount] = useState({ active: 0, total: 0 });

    useEffect(() => {
        const tasksRef = collection(db, "projects", project.id, "tasks");
        const q = query(tasksRef);
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const tasks = snapshot.docs.map(doc => doc.data());
            const activeTasks = tasks.filter(t => t.status === 'todo' || t.status === 'inprogress').length;
            setTaskCount({ active: activeTasks, total: tasks.length });
        });
        return () => unsubscribe();
    }, [project.id]);

    return (
        <div className="group relative block bg-white rounded-lg shadow-md hover:shadow-xl transition-shadow overflow-hidden">
            <Link to={`/project/${project.id}`} className="block p-6">
                <div className="flex justify-between items-start">
                    <div>
                        <div className="relative inline-block text-xl font-semibold text-primary after:absolute after:bottom-[-2px] after:left-0 after:h-[2px] after:w-full after:bg-accent-teal after:scale-x-0 after:origin-left after:transition-transform group-hover:after:scale-x-100">{project.name}</div>
                        <p className="text-sm text-gray-500 mt-1">Created on: {project.createdAt?.toDate().toLocaleDateString() || 'N/A'}</p>
                    </div>
                    <div className="text-right">
                        <p className="font-bold text-primary text-2xl">{taskCount.active}</p>
                        <p className="text-xs text-gray-400">Active Tasks</p>
                    </div>
                </div>
            </Link>
            {(role === 'manager' || role === 'admin') && (
                <button onClick={(e) => { e.preventDefault(); onDelete(project.id); }} className="absolute top-0 right-0 h-full px-5 bg-accent-red text-white flex items-center justify-center transform translate-x-full group-hover:translate-x-0 transition-transform">Delete</button>
            )}
        </div>
    );
}


function Dashboard() {
  const { user, role, loading: authLoading } = useAuth();
  const [projects, setProjects] = useState([]);
  const [newProjectName, setNewProjectName] = useState("");
  const [assignedTeamId, setAssignedTeamId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  
  const [allUsers, setAllUsers] = useState([]);
  const [myTeams, setMyTeams] = useState([]);
  const [teams, setTeams] = useState([]);
  const [newTeamName, setNewTeamName] = useState("");
  const [selectedDevs, setSelectedDevs] = useState([]);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [editingTeam, setEditingTeam] = useState(null);

  const [messages, setMessages] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showMessagesModal, setShowMessagesModal] = useState(false);
  const [newMessage, setNewMessage] = useState("");
  const [recipient, setRecipient] = useState("");

  // --- REFACTORED DATA FETCHING HOOKS ---

  // Effect for common data (messages, my teams)
  useEffect(() => {
    if (!user) return;

    const myTeamsQuery = query(collection(db, "teams"), where("members", "array-contains", user.email));
    const unsubMyTeams = onSnapshot(myTeamsQuery, (snapshot) => setMyTeams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));

    const messagesQuery = query(collection(db, "messages"), where("recipientEmail", "==", user.email), orderBy("createdAt", "desc"));
    const unsubMessages = onSnapshot(messagesQuery, (snapshot) => {
        const allMessages = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setMessages(allMessages);
        setUnreadCount(allMessages.filter(msg => !msg.read).length);
    });

    return () => {
        unsubMyTeams();
        unsubMessages();
    };
  }, [user]);

  // Effect for fetching projects based on role
  useEffect(() => {
    if (!user || !role) {
      setLoading(false);
      return;
    }

    let unsubscribe;

    if (role === 'manager' || role === 'admin') {
        const projectsQuery = query(collection(db, "projects"), where("creatorId", "==", user.uid));
        unsubscribe = onSnapshot(projectsQuery, (snapshot) => {
            setProjects(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setLoading(false);
        });
    } else if (role === 'developer') {
        const myTeamsQuery = query(collection(db, "teams"), where("members", "array-contains", user.email));
        unsubscribe = onSnapshot(myTeamsQuery, (teamsSnapshot) => {
            const teamIds = teamsSnapshot.docs.map(doc => doc.id);
            if (teamIds.length > 0) {
                const projectsQuery = query(collection(db, "projects"), where("assignedTeamId", "in", teamIds));
                // This inner listener needs its own cleanup, which is returned by the outer listener's callback
                const unsubProjects = onSnapshot(projectsQuery, (projectsSnapshot) => {
                    setProjects(projectsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
                    setLoading(false);
                });
                return () => unsubProjects(); // Cleanup the inner listener
            } else {
                setProjects([]);
                setLoading(false);
                return () => {}; // Return an empty cleanup function if no project listener was created
            }
        });
    } else {
        setLoading(false);
    }

    return () => {
        if (unsubscribe) unsubscribe(); // Cleanup the main listener
    };
  }, [user, role]);

  // Effect for manager-specific data
  useEffect(() => {
    if (role === 'manager' || role === 'admin') {
      const usersQuery = query(collection(db, "users"));
      const unsubUsers = onSnapshot(usersQuery, (snapshot) => setAllUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
      const teamsQuery = query(collection(db, "teams"), where("managerId", "==", user?.uid));
      const unsubTeams = onSnapshot(teamsQuery, (snapshot) => setTeams(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))));
      return () => { unsubUsers(); unsubTeams(); };
    }
  }, [role, user]);

  // Project Handlers
  const handleAddProject = async (e) => {
    e.preventDefault();
    if (!newProjectName.trim() || !user) return;
    const team = teams.find(t => t.id === assignedTeamId);
    await addDoc(collection(db, "projects"), { name: newProjectName, creatorId: user.uid, creatorEmail: user.email, assignedTeamId: assignedTeamId, members: team ? team.members : [], createdAt: serverTimestamp() });
    setNewProjectName("");
    setAssignedTeamId("");
  };
  const handleDeleteProject = async (projectId) => await deleteDoc(doc(db, "projects", projectId));

  // Team Handlers
  const handleTeamSubmit = async (e) => {
    e.preventDefault();
    if (!newTeamName.trim() || selectedDevs.length === 0) { setError("Team name and at least one member are required."); return; }
    const teamData = { name: newTeamName, members: selectedDevs, managerId: user.uid };
    if (editingTeam) { await updateDoc(doc(db, "teams", editingTeam.id), teamData); } else { await addDoc(collection(db, "teams"), teamData); }
    closeTeamModal();
  };
  const handleDeleteTeam = async (teamId) => await deleteDoc(doc(db, "teams", teamId));
  const openEditTeamModal = (team) => { setEditingTeam(team); setNewTeamName(team.name); setSelectedDevs(team.members); setShowTeamModal(true); };
  const closeTeamModal = () => { setEditingTeam(null); setNewTeamName(""); setSelectedDevs([]); setShowTeamModal(false); setError(""); };
  const handleDevSelection = (devEmail) => setSelectedDevs(prev => prev.includes(devEmail) ? prev.filter(email => email !== devEmail) : [...prev, devEmail]);

  // Message Handlers
  const handleSendMessage = async (e) => {
      e.preventDefault();
      if (!newMessage.trim() || !recipient) { setError("Please select a recipient and write a message."); return; }
      await addDoc(collection(db, "messages"), { text: newMessage, senderEmail: user.email, recipientEmail: recipient, createdAt: serverTimestamp(), read: false });
      setNewMessage("");
      setRecipient("");
      setShowMessagesModal(false);
      setError("");
  };
  const handleDeleteMessage = async (messageId) => await deleteDoc(doc(db, "messages", messageId));
  const handleMarkAllRead = async () => {
      const batch = writeBatch(db);
      messages.forEach(msg => {
          if (!msg.read) {
              const msgRef = doc(db, "messages", msg.id);
              batch.update(msgRef, { read: true });
          }
      });
      await batch.commit();
  };

  if (loading || authLoading) return <div className="text-center mt-12 text-primary">Loading...</div>;
  const developers = allUsers.filter(u => u.role === 'developer');

  return (
    <div className="min-h-screen bg-secondary-grey">
      <div className="max-w-4xl mx-auto py-8 px-4">
        <h1 className="text-4xl font-bold text-primary mb-8">Dashboard</h1>
        
        {(role === 'manager' || role === 'admin') && (
          <>
            <div className="bg-white p-6 rounded-lg shadow-md mb-8"><h2 className="text-2xl font-semibold text-primary mb-4">Project Management</h2><form onSubmit={handleAddProject} className="space-y-4"><input type="text" value={newProjectName} onChange={(e) => setNewProjectName(e.target.value)} placeholder="Enter a new project name..." className="w-full p-3 border rounded-md focus:ring-2 focus:ring-primary"/><select value={assignedTeamId} onChange={(e) => setAssignedTeamId(e.target.value)} className="w-full p-3 border rounded-md"><option value="">Assign to a team (optional)</option>{teams.map(team => <option key={team.id} value={team.id}>{team.name}</option>)}</select><button type="submit" className="w-full px-6 py-3 bg-primary text-white font-semibold rounded-md hover:bg-opacity-90">Add Project</button></form>{error && <p className="mt-4 text-accent-red">{error}</p>}</div>
            <div className="bg-white p-6 rounded-lg shadow-md mb-8"><div className="flex justify-between items-center"><h2 className="text-2xl font-semibold text-primary">Team Management</h2><button onClick={() => setShowTeamModal(true)} className="px-4 py-2 bg-accent-teal text-white font-semibold rounded-md hover:bg-opacity-90">Create Team</button></div><div className="mt-4 space-y-2">{teams.map(team => (<div key={team.id} className="flex justify-between items-center p-3 border rounded-md"><div><p className="font-bold text-primary">{team.name}</p><p className="text-sm text-gray-500">Members: {team.members.join(', ')}</p></div><div className="flex gap-2"><button onClick={() => openEditTeamModal(team)} className="text-gray-400 hover:text-primary"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z" /></svg></button><button onClick={() => handleDeleteTeam(team.id)} className="text-gray-400 hover:text-accent-red"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg></button></div></div>))}</div></div>
          </>
        )}

        <div className="bg-white p-6 rounded-lg shadow-md mb-8"><h2 className="text-2xl font-semibold text-primary">My Teams</h2><div className="mt-4 space-y-2">{myTeams.length > 0 ? myTeams.map(team => (<div key={team.id} className="p-3 bg-secondary-blue bg-opacity-20 rounded-md"><p className="font-bold text-primary">{team.name}</p></div>)) : (<p className="text-gray-500">You are not a member of any teams yet.</p>)}</div></div>
        
        <div className="bg-white p-6 rounded-lg shadow-md mb-8">
            <div className="flex justify-between items-center">
                <div className="flex items-center gap-3"><h2 className="text-2xl font-semibold text-primary">Inbox</h2>{unreadCount > 0 && <span className="bg-accent-red text-white text-xs font-bold px-2 py-1 rounded-full">{unreadCount}</span>}</div>
                <div className="flex gap-2"><button onClick={handleMarkAllRead} className="text-sm text-gray-500 hover:underline">Mark all as read</button><button onClick={() => setShowMessagesModal(true)} className="px-4 py-2 bg-accent-teal text-white font-semibold rounded-md hover:bg-opacity-90">Send Message</button></div>
            </div>
            <div className="mt-4 space-y-3 max-h-60 overflow-y-auto">{messages.length > 0 ? messages.map(msg => (<div key={msg.id} className={`relative p-3 border-l-4 rounded-r-md ${msg.read ? 'bg-gray-50' : 'bg-secondary-blue bg-opacity-40 border-primary'}`}><p className="text-sm text-gray-600">From: <span className="font-semibold">{msg.senderEmail}</span></p><p className="text-primary mt-1">{msg.text}</p><p className="text-xs text-gray-400 text-right mt-2">{msg.createdAt?.toDate().toLocaleString()}</p><button onClick={() => handleDeleteMessage(msg.id)} className="absolute top-2 right-2 text-gray-400 hover:text-accent-red">&times;</button></div>)) : (<p className="text-gray-500">You have no new messages.</p>)}</div>
        </div>
        
        <div>
          <h2 className="text-2xl font-semibold text-primary mb-4">My Projects</h2>
          {projects.length > 0 ? (<div className="space-y-4">{projects.map((project) => (<ProjectCard key={project.id} project={project} role={role} onDelete={handleDeleteProject} />))}</div>) : (<div className="bg-white p-6 rounded-lg shadow-md text-center text-gray-500"><p>No projects to display.</p></div>)}
        </div>

        {/* Modals */}
        {showTeamModal && (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"><div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md"><h3 className="text-2xl font-bold text-primary mb-4">{editingTeam ? 'Update Team' : 'Create a New Team'}</h3><form onSubmit={handleTeamSubmit}><input type="text" value={newTeamName} onChange={(e) => setNewTeamName(e.target.value)} placeholder="Team Name" className="w-full p-2 mb-4 border rounded-md"/><div className="mb-4"><p className="font-semibold mb-2">Select Team Members</p><div className="max-h-40 overflow-y-auto space-y-2">{developers.map(dev => (<label key={dev.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-secondary-grey cursor-pointer"><input type="checkbox" checked={selectedDevs.includes(dev.email)} onChange={() => handleDevSelection(dev.email)} className="h-4 w-4 rounded text-primary focus:ring-primary"/>{dev.email}</label>))}</div></div><div className="flex justify-end gap-4"><button type="button" onClick={closeTeamModal} className="px-4 py-2 bg-gray-300 rounded-md">Cancel</button><button type="submit" className="px-4 py-2 bg-primary text-white rounded-md">{editingTeam ? 'Update' : 'Create'}</button></div></form></div></div>)}
        {showMessagesModal && (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"><div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md"><h3 className="text-2xl font-bold text-primary mb-4">Send a Message</h3><form onSubmit={handleSendMessage}><div className="mb-4"><label htmlFor="recipient" className="block text-sm font-medium text-gray-700 mb-1">Recipient</label><select id="recipient" value={recipient} onChange={(e) => setRecipient(e.target.value)} className="w-full p-2 border rounded-md"><option value="">Select a user...</option>{allUsers.map(u => <option key={u.id} value={u.email}>{u.email}</option>)}</select></div><textarea value={newMessage} onChange={(e) => setNewMessage(e.target.value)} placeholder="Your message..." className="w-full p-2 mb-4 border rounded-md h-28"/><div className="flex justify-end gap-4"><button type="button" onClick={() => setShowMessagesModal(false)} className="px-4 py-2 bg-gray-300 rounded-md">Cancel</button><button type="submit" className="px-4 py-2 bg-primary text-white rounded-md">Send</button></div></form></div></div>)}
      </div>
    </div>
  );
}

export default Dashboard;
