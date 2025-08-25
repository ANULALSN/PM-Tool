import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, onSnapshot, collection, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, query, orderBy, Timestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { useAuth } from '../hooks/useAuth';

// --- Helper function to get a weight for each priority ---
const getPriorityWeight = (priority) => {
  switch (priority?.toLowerCase()) {
    case 'high': return 3;
    case 'medium': return 2;
    case 'low': return 1;
    default: return 1;
  }
};

// --- New sort function to order tasks by logical step ---
const sortTasks = (tasks) => {
  return tasks.sort((a, b) => {
    if (a.step !== b.step) {
      return (a.step || 999) - (b.step || 999);
    }
    return getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
  });
};

// --- Updated Progress Bar Component ---
function ProjectProgressBar({ tasks }) {
  const totalPossibleWeight = tasks.reduce((acc, task) => acc + getPriorityWeight(task.priority), 0);
  const completedWeight = tasks.filter(task => task.status === 'done').reduce((acc, task) => acc + getPriorityWeight(task.priority), 0);
  if (totalPossibleWeight === 0) return <p className="text-sm text-gray-500">Add a task to see project progress.</p>;
  const progressPercent = (completedWeight / totalPossibleWeight) * 100;
  return (
    <div className="w-full bg-secondary-grey rounded-full h-6 overflow-hidden border">
      <div className="bg-accent-teal h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500" style={{ width: `${progressPercent}%` }}>
        {progressPercent > 10 && `${Math.round(progressPercent)}%`}
      </div>
    </div>
  );
}

function Project() {
  const { id } = useParams();
  const { user, role } = useAuth();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState('');
  const [newDueDate, setNewDueDate] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTask, setEditingTask] = useState({ id: null, text: '' });
  const [allUsers, setAllUsers] = useState([]);
  
  // State for modals
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [selectedTask, setSelectedTask] = useState(null);
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');

  // Effect to fetch all users (for managers to assign tasks)
  useEffect(() => {
    if (role === 'manager' || role === 'admin') {
      const usersQuery = query(collection(db, "users"));
      const unsubscribe = onSnapshot(usersQuery, (snapshot) => {
        setAllUsers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      });
      return () => unsubscribe();
    }
  }, [role]);

  // Effect to fetch project and tasks
  useEffect(() => {
    // --- FIX: Add a guard clause to ensure 'id' exists ---
    if (!id) {
      setError('No project ID provided. Please return to the dashboard.');
      setLoading(false);
      return;
    }

    const projectRef = doc(db, 'projects', id);
    const unsubProject = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) setProject({ id: docSnap.id, ...docSnap.data() });
      else setError('Project not found.');
      setLoading(false);
    }, (err) => {
        setError('Failed to fetch project details.');
        setLoading(false);
    });

    const tasksRef = collection(db, 'projects', id, 'tasks');
    const q = query(tasksRef, orderBy('createdAt'));
    const unsubTasks = onSnapshot(q, (snapshot) => {
      setTasks(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    }, (err) => {
        setError('Failed to fetch tasks.');
    });

    return () => {
      unsubProject();
      unsubTasks();
    };
  }, [id]);
  
  // Effect to fetch comments for the selected task
  useEffect(() => {
      if (selectedTask) {
          const commentsRef = collection(db, 'projects', id, 'tasks', selectedTask.id, 'comments');
          const q = query(commentsRef, orderBy('createdAt', 'desc'));
          const unsubscribe = onSnapshot(q, (snapshot) => {
              setComments(snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})));
          });
          return () => unsubscribe();
      }
  }, [selectedTask, id]);

  // --- AI Task Generation Function ---
  const handleGenerateTasks = async () => {
    if (!aiPrompt.trim()) {
      setError("Please enter a project goal for the AI.");
      return;
    }
    setIsGenerating(true);
    setError('');
    const userPrompt = `Based on the project goal "${aiPrompt}", generate a list of tasks. For each task, provide a descriptive name, a priority level ('High', 'Medium', or 'Low'), and a 'step' number representing the logical order to complete them.`;
    const payload = { contents: [{ role: "user", parts: [{ text: userPrompt }] }], generationConfig: { responseMimeType: "application/json", responseSchema: { type: "ARRAY", items: { type: "OBJECT", properties: { name: { type: "STRING" }, priority: { type: "STRING" }, step: { type: "NUMBER" }, }, required: ["name", "priority", "step"], }, }, }, };
    try {
      // --- IMPORTANT: PASTE YOUR API KEY HERE ---
      const apiKey = "YOUR_API_KEY_HERE"; 
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      const response = await fetch(apiUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      if (!response.ok) { const errorBody = await response.text(); throw new Error(`API request failed with status ${response.status}: ${errorBody}`); }
      const result = await response.json();
      if (!result.candidates || result.candidates.length === 0) { throw new Error("The AI did not return any tasks."); }
      const generatedText = result.candidates[0].content.parts[0].text;
      let generatedTasks;
      try { generatedTasks = JSON.parse(generatedText); } catch (parseError) { throw new Error("The AI returned a response in an invalid format."); }
      const batch = writeBatch(db);
      const tasksRef = collection(db, 'projects', id, 'tasks');
      generatedTasks.forEach(task => {
        const newDocRef = doc(tasksRef);
        batch.set(newDocRef, { text: task.name, priority: task.priority, step: task.step, status: 'todo', assignedTo: null, dueDate: null, createdAt: serverTimestamp(), });
      });
      await batch.commit();
      setAiPrompt('');
    } catch (err) { setError(err.message); } finally { setIsGenerating(false); }
  };

  // --- All Other Handlers ---
  const handleAddTask = async (e) => {
    e.preventDefault();
    if (newTask.trim() === '') return;
    const maxStep = tasks.length > 0 ? Math.max(...tasks.map(t => t.step || 0)) : 0;
    await addDoc(collection(db, 'projects', id, 'tasks'), { text: newTask, status: 'todo', priority: 'Medium', step: maxStep + 1, assignedTo: null, dueDate: newDueDate ? Timestamp.fromDate(new Date(newDueDate)) : null, createdAt: serverTimestamp(), });
    setNewTask('');
    setNewDueDate('');
  };

  const handleUpdateTask = async (taskId, newText) => {
    if (newText.trim() === '') return;
    await updateDoc(doc(db, 'projects', id, 'tasks', taskId), { text: newText });
    setEditingTask({ id: null, text: '' });
  };
  
  const handleUpdateTaskDetails = async (taskId, details) => await updateDoc(doc(db, 'projects', id, 'tasks', taskId), details);
  const handleDeleteTask = async (taskId) => await deleteDoc(doc(db, 'projects', id, 'tasks', taskId));
  const handleDragStart = (e, taskId) => e.dataTransfer.setData("taskId", taskId);
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = async (e, newStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    if (taskId) await updateDoc(doc(db, 'projects', id, 'tasks', taskId), { status: newStatus });
  };
  
  const handleAddComment = async (e) => {
      e.preventDefault();
      if (!newComment.trim() || !selectedTask || !user) return;
      const commentsRef = collection(db, 'projects', id, 'tasks', selectedTask.id, 'comments');
      await addDoc(commentsRef, {
          text: newComment,
          author: user.email,
          createdAt: serverTimestamp(),
      });
      setNewComment('');
  };

  // Filter and sort tasks
  const todoTasks = sortTasks(tasks.filter(task => task.status === 'todo'));
  const inProgressTasks = sortTasks(tasks.filter(task => task.status === 'inprogress'));
  const doneTasks = sortTasks(tasks.filter(task => task.status === 'done'));
  const assignedTasks = tasks.filter(task => task.assignedTo === auth.currentUser?.email && task.status !== 'done');
  const developers = allUsers.filter(u => u.role === 'developer');

  const priorityColorClass = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'border-accent-red';
      case 'medium': return 'border-yellow-500';
      case 'low': return 'border-gray-400';
      default: return 'border-gray-400';
    }
  };
  
  const getDueDateStatus = (dueDate) => {
      if (!dueDate) return null;
      const today = new Date();
      const date = dueDate.toDate();
      today.setHours(0,0,0,0);
      date.setHours(0,0,0,0);
      const diffTime = date.getTime() - today.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      if (diffDays < 0) return { text: 'Overdue', color: 'bg-accent-red' };
      if (diffDays <= 3) return { text: `Due in ${diffDays} day(s)`, color: 'bg-yellow-500' };
      return { text: `Due on ${date.toLocaleDateString()}`, color: 'bg-green-500' };
  };

  if (loading) return <div className="text-center mt-12 text-primary">Loading...</div>;
  
  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      {project && <h1 className="text-4xl font-bold text-primary">Project: {project.name}</h1>}
      {assignedTasks.length > 0 && (<div className="my-8 p-4 bg-secondary-pink rounded-lg border border-red-200"><h3 className="font-semibold text-accent-red">🔔 Your Active Tasks</h3><ul className="list-disc list-inside mt-2 text-sm text-red-900">{assignedTasks.map(task => <li key={task.id}>{task.text}</li>)}</ul></div>)}
      <div className="my-8"><h2 className="text-2xl font-semibold text-primary mb-2">Progress</h2><ProjectProgressBar tasks={tasks} /></div>
      {error && <div className="my-6 p-4 bg-secondary-pink text-accent-red border border-red-200 rounded-lg">{error}</div>}
      
      <div className="my-8 p-6 bg-secondary-blue bg-opacity-40 rounded-lg border border-blue-200"><h3 className="text-xl font-semibold text-primary">✨ Generate Tasks with AI</h3><p className="text-sm text-gray-600 mt-1">Describe your project goal, and the AI will suggest a logical task sequence for you.</p><textarea value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="e.g., 'Create a machine learning model to predict customer churn...'" className="w-full mt-4 p-2 border rounded-md focus:ring-2 focus:ring-primary" disabled={isGenerating}/><button onClick={handleGenerateTasks} disabled={isGenerating} className="mt-4 px-4 py-2 bg-primary text-white rounded-md hover:bg-opacity-90 disabled:bg-opacity-50 transition-colors">{isGenerating ? 'Generating...' : 'Generate Tasks'}</button></div>

      <form onSubmit={handleAddTask} className="flex flex-col sm:flex-row gap-4 mb-8">
        <input type="text" value={newTask} onChange={(e) => setNewTask(e.target.value)} placeholder="Add a new task..." className="flex-grow p-2 border rounded-md focus:ring-2 focus:ring-accent-teal"/>
        {(role === 'manager' || role === 'admin') && (<input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="p-2 border rounded-md focus:ring-2 focus:ring-accent-teal"/>)}
        <button type="submit" className="px-4 py-2 bg-accent-teal text-white rounded-md hover:bg-opacity-90">Add Task</button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {[ { title: 'To Do', tasks: todoTasks, status: 'todo' }, { title: 'In Progress', tasks: inProgressTasks, status: 'inprogress' }, { title: 'Done', tasks: doneTasks, status: 'done' } ].map(({ title, tasks, status }) => (
          <div key={status} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, status)} className="bg-secondary-grey p-4 rounded-lg min-h-[200px]">
            <h3 className="font-bold text-xl text-primary border-b-2 border-gray-200 pb-2">{title}</h3>
            <div className="mt-4 space-y-4">
              {tasks.map(task => (
                <div key={task.id} draggable onDragStart={(e) => handleDragStart(e, task.id)} onClick={() => setSelectedTask(task)} className={`group relative bg-white rounded-md shadow-sm cursor-pointer border-l-4 overflow-hidden ${status === 'done' ? 'border-accent-teal' : priorityColorClass(task.priority)}`}>
                  <div className="p-3 transition-all duration-300 group-hover:w-10/12">
                    {editingTask.id === task.id ? (<input type="text" value={editingTask.text} onChange={(e) => setEditingTask({ ...editingTask, text: e.target.value })} onBlur={() => handleUpdateTask(task.id, editingTask.text)} onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateTask(task.id, editingTask.text) }} className="w-full focus:outline-none" autoFocus/>) : (<div className={status === 'done' ? 'text-gray-500 line-through' : ''}><span className="font-semibold text-gray-500 mr-2">{task.step}.</span>{task.text}</div>)}
                    {task.dueDate && (<div className="flex items-center gap-2 mt-2 text-xs"><span className={`w-2 h-2 rounded-full ${getDueDateStatus(task.dueDate)?.color}`}></span><span className="text-gray-500">{getDueDateStatus(task.dueDate)?.text}</span></div>)}
                    {task.assignedTo && <div className="text-xs text-gray-400 mt-2">Assigned to: {task.assignedTo}</div>}
                  </div>
                  <div className="absolute top-0 right-0 h-full w-1/5 bg-gray-500/10 backdrop-blur-sm flex flex-col items-center justify-center gap-2 transform translate-x-full group-hover:translate-x-0 transition-transform duration-300 ease-in-out">
                    {(role === 'manager' || role === 'admin') && (<button onClick={(e) => {e.stopPropagation(); setSelectedTask(task); setShowAssignModal(true);}} className="text-gray-500 hover:text-accent-teal" aria-label="Assign task"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path d="M8 9a3 3 0 100-6 3 3 0 000 6zM8 11a6 6 0 016 6H2a6 6 0 016-6zM16 11a1 1 0 10-2 0v1h-1a1 1 0 100 2h1v1a1 1 0 102 0v-1h1a1 1 0 100-2h-1v-1z" /></svg></button>)}
                    <button onClick={(e) => {e.stopPropagation(); setEditingTask({ id: task.id, text: task.text });}} className="text-gray-500 hover:text-primary" aria-label="Edit task"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z" /></svg></button>
                    <button onClick={(e) => {e.stopPropagation(); handleDeleteTask(task.id);}} className="text-gray-500 hover:text-accent-red" aria-label="Delete task"><svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" /></svg></button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* --- Modals --- */}
      {showAssignModal && selectedTask && (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50"><div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md"><h3 className="text-2xl font-bold text-primary mb-4">Assign Task</h3><p className="mb-4">{selectedTask.text}</p><div className="mb-4"><label htmlFor="assignee" className="block text-sm font-medium text-gray-700 mb-1">Select Developer</label><select id="assignee" defaultValue={selectedTask.assignedTo || ""} onChange={(e) => handleUpdateTaskDetails(selectedTask.id, { assignedTo: e.target.value })} className="w-full p-2 border rounded-md"><option value="">Unassigned</option>{developers.map(dev => <option key={dev.id} value={dev.email}>{dev.email}</option>)}</select></div><div className="flex justify-end"><button onClick={() => setShowAssignModal(false)} className="px-4 py-2 bg-gray-300 rounded-md">Close</button></div></div></div>)}
      {showDetailsModal && selectedTask && (<div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50" onClick={() => setShowDetailsModal(false)}><div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}><h3 className="text-2xl font-bold text-primary mb-4">{selectedTask.text}</h3>{(role === 'manager' || role === 'admin') && (<div className="mb-4"><label htmlFor="dueDate" className="block text-sm font-medium text-gray-700 mb-1">Due Date</label><input type="date" id="dueDate" defaultValue={selectedTask.dueDate?.toDate().toISOString().split('T')[0] || ''} onChange={(e) => handleUpdateTaskDetails(selectedTask.id, { dueDate: Timestamp.fromDate(new Date(e.target.value)) })} className="w-full p-2 border rounded-md"/></div>)}<div className="mb-4"><h4 className="font-semibold text-primary mb-2">Comments</h4><div className="max-h-40 overflow-y-auto space-y-2 mb-4">{comments.map(comment => (<div key={comment.id} className="text-sm"><p className="font-semibold">{comment.author}</p><p>{comment.text}</p></div>))}</div><form onSubmit={handleAddComment} className="flex gap-2"><input type="text" value={newComment} onChange={(e) => setNewComment(e.target.value)} placeholder="Add a comment..." className="flex-grow p-2 border rounded-md"/><button type="submit" className="px-4 py-2 bg-primary text-white rounded-md">Add</button></form></div><div className="flex justify-end mt-4"><button onClick={() => setShowDetailsModal(false)} className="px-4 py-2 bg-gray-300 rounded-md">Close</button></div></div></div>)}

      <div className="mt-8"><Link to="/dashboard" className="text-primary hover:underline">← Back to Dashboard</Link></div>
    </div>
  );
}

export default Project;
