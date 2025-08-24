import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { doc, onSnapshot, collection, addDoc, updateDoc, deleteDoc, writeBatch, serverTimestamp, query, orderBy } from 'firebase/firestore';
import { db } from '../firebase';

// --- Helper function to get a weight for each priority ---
const getPriorityWeight = (priority) => {
  switch (priority?.toLowerCase()) {
    case 'high':
      return 3;
    case 'medium':
      return 2;
    case 'low':
      return 1;
    default:
      return 1;
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
  const completedWeight = tasks
    .filter(task => task.status === 'done')
    .reduce((acc, task) => acc + getPriorityWeight(task.priority), 0);

  if (totalPossibleWeight === 0) {
    return <p className="text-sm text-gray-500">Add a task to see project progress.</p>;
  }

  const progressPercent = (completedWeight / totalPossibleWeight) * 100;

  return (
    <div className="w-full bg-secondary-grey rounded-full h-6 overflow-hidden border">
      <div 
        className="bg-accent-teal h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all duration-500"
        style={{ width: `${progressPercent}%` }}
      >
        {progressPercent > 10 && `${Math.round(progressPercent)}%`}
      </div>
    </div>
  );
}


function Project() {
  const { id } = useParams();
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [newTask, setNewTask] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingTask, setEditingTask] = useState({ id: null, text: '' }); // State for inline editing

  // Effect to fetch project details
  useEffect(() => {
    const projectRef = doc(db, 'projects', id);
    const unsubscribe = onSnapshot(projectRef, (docSnap) => {
      if (docSnap.exists()) {
        setProject({ id: docSnap.id, ...docSnap.data() });
      } else {
        setError('Project not found.');
        setProject(null);
      }
      setLoading(false);
    });
    return () => unsubscribe();
  }, [id]);

  // Effect to fetch tasks for the project
  useEffect(() => {
    if (!id) return;
    const tasksRef = collection(db, 'projects', id, 'tasks');
    const q = query(tasksRef, orderBy('createdAt'));
    const unsubscribe = onSnapshot(q, (querySnapshot) => {
      const tasksData = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTasks(tasksData);
    });
    return () => unsubscribe();
  }, [id]);

  // --- AI Task Generation Function ---
  const handleGenerateTasks = async () => {
    if (!aiPrompt.trim()) {
      setError("Please enter a project goal for the AI.");
      return;
    }
    setIsGenerating(true);
    setError('');

    const userPrompt = `Based on the project goal "${aiPrompt}", generate a list of tasks. For each task, provide a descriptive name, a priority level ('High', 'Medium', or 'Low'), and a 'step' number representing the logical order to complete them.`;
    
    const payload = {
      contents: [{ role: "user", parts: [{ text: userPrompt }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            properties: {
              name: { type: "STRING" },
              priority: { type: "STRING" },
              step: { type: "NUMBER" }, 
            },
            required: ["name", "priority", "step"],
          },
        },
      },
    };

    try {
      const apiKey = "AIzaSyD_ndP20_6iEaFXcjt8fOj_yNatjoWdD_0"; 
      const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`API request failed with status ${response.status}: ${errorBody}`);
      }

      const result = await response.json();
      
      if (!result.candidates || result.candidates.length === 0) {
        throw new Error("The AI did not return any tasks. This could be due to a safety filter or an invalid prompt.");
      }

      const generatedText = result.candidates[0].content.parts[0].text;
      let generatedTasks;

      try {
        generatedTasks = JSON.parse(generatedText);
      } catch (parseError) {
        throw new Error("The AI returned a response in an invalid format. Please try again.");
      }

      const batch = writeBatch(db);
      const tasksRef = collection(db, 'projects', id, 'tasks');
      generatedTasks.forEach(task => {
        const newDocRef = doc(tasksRef);
        batch.set(newDocRef, {
          text: task.name,
          priority: task.priority,
          step: task.step, 
          status: 'todo',
          createdAt: serverTimestamp(),
        });
      });
      await batch.commit();
      setAiPrompt('');

    } catch (err) {
      setError(err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  // Function to add a single manual task
  const handleAddTask = async (e) => {
    e.preventDefault();
    if (newTask.trim() === '') return;
    
    const maxStep = tasks.length > 0 ? Math.max(...tasks.map(t => t.step || 0)) : 0;

    const tasksRef = collection(db, 'projects', id, 'tasks');
    await addDoc(tasksRef, {
      text: newTask,
      status: 'todo',
      priority: 'Medium',
      step: maxStep + 1,
      createdAt: serverTimestamp(),
    });
    setNewTask('');
  };

  // --- Function to handle updating a task ---
  const handleUpdateTask = async (taskId, newText) => {
    if (newText.trim() === '') return; // Prevent saving empty tasks
    try {
      const taskRef = doc(db, 'projects', id, 'tasks', taskId);
      await updateDoc(taskRef, { text: newText });
      setEditingTask({ id: null, text: '' }); // Exit edit mode
    } catch (err) {
      setError("Failed to update task.");
      console.error("Error updating task: ", err);
    }
  };

  // --- Function to handle deleting a task ---
  const handleDeleteTask = async (taskId) => {
    try {
      const taskRef = doc(db, 'projects', id, 'tasks', taskId);
      await deleteDoc(taskRef);
    } catch (err) {
      setError("Failed to delete task.");
      console.error("Error deleting task: ", err);
    }
  };

  // Drag and Drop Handlers
  const handleDragStart = (e, taskId) => e.dataTransfer.setData("taskId", taskId);
  const handleDragOver = (e) => e.preventDefault();
  const handleDrop = async (e, newStatus) => {
    e.preventDefault();
    const taskId = e.dataTransfer.getData("taskId");
    if (taskId) {
      const taskRef = doc(db, 'projects', id, 'tasks', taskId);
      await updateDoc(taskRef, { status: newStatus });
    }
  };

  // Filter and sort tasks into columns
  const todoTasks = sortTasks(tasks.filter(task => task.status === 'todo'));
  const inProgressTasks = sortTasks(tasks.filter(task => task.status === 'inprogress'));
  const doneTasks = sortTasks(tasks.filter(task => task.status === 'done'));

  const priorityColorClass = (priority) => {
    switch (priority?.toLowerCase()) {
      case 'high': return 'border-accent-red';
      case 'medium': return 'border-yellow-500';
      case 'low': return 'border-gray-400';
      default: return 'border-gray-400';
    }
  };

  if (loading) return <div className="text-center mt-12 text-primary">Loading...</div>;
  
  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 lg:p-8">
      {project && <h1 className="text-4xl font-bold text-primary">Project: {project.name}</h1>}

      <div className="my-8">
        <h2 className="text-2xl font-semibold text-primary mb-2">Progress</h2>
        <ProjectProgressBar tasks={tasks} />
      </div>

      {error && <div className="my-6 p-4 bg-secondary-pink text-accent-red border border-red-200 rounded-lg">{error}</div>}
      
      <div className="my-8 p-6 bg-secondary-blue bg-opacity-40 rounded-lg border border-blue-200">
        <h3 className="text-xl font-semibold text-primary">✨ Generate Tasks with AI</h3>
        <p className="text-sm text-gray-600 mt-1">Describe your project goal, and the AI will suggest a logical task sequence for you.</p>
        <textarea
          value={aiPrompt}
          onChange={(e) => setAiPrompt(e.target.value)}
          placeholder="e.g., 'Create a machine learning model to predict customer churn...'"
          className="w-full mt-4 p-2 border rounded-md focus:ring-2 focus:ring-primary"
          disabled={isGenerating}
        />
        <button onClick={handleGenerateTasks} disabled={isGenerating} className="mt-4 px-4 py-2 bg-primary text-white rounded-md hover:bg-opacity-90 disabled:bg-opacity-50 transition-colors">
          {isGenerating ? 'Generating...' : 'Generate Tasks'}
        </button>
      </div>

      <form onSubmit={handleAddTask} className="flex gap-4 mb-8">
        <input
          type="text"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          placeholder="Or add a single task manually..."
          className="flex-grow p-2 border rounded-md focus:ring-2 focus:ring-accent-teal"
        />
        <button type="submit" className="px-4 py-2 bg-accent-teal text-white rounded-md hover:bg-opacity-90 transition-colors">
          Add Task
        </button>
      </form>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Kanban Columns */}
        {[
          { title: 'To Do', tasks: todoTasks, status: 'todo' },
          { title: 'In Progress', tasks: inProgressTasks, status: 'inprogress' },
          { title: 'Done', tasks: doneTasks, status: 'done' }
        ].map(({ title, tasks, status }) => (
          <div key={status} onDragOver={handleDragOver} onDrop={(e) => handleDrop(e, status)} className="bg-secondary-grey p-4 rounded-lg min-h-[200px]">
            <h3 className="font-bold text-xl text-primary border-b-2 border-gray-200 pb-2">{title}</h3>
            <div className="mt-4 space-y-4">
              {tasks.map(task => (
                <div key={task.id} draggable onDragStart={(e) => handleDragStart(e, task.id)} className={`group relative bg-white p-3 rounded-md shadow-sm cursor-grab border-l-4 ${status === 'done' ? 'border-accent-teal' : priorityColorClass(task.priority)}`}>
                  {editingTask.id === task.id ? (
                    <input
                      type="text"
                      value={editingTask.text}
                      onChange={(e) => setEditingTask({ ...editingTask, text: e.target.value })}
                      onBlur={() => handleUpdateTask(task.id, editingTask.text)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleUpdateTask(task.id, editingTask.text) }}
                      className="w-full focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <div className={status === 'done' ? 'text-gray-500 line-through' : ''}>
                      <span className="font-semibold text-gray-500 mr-2">{task.step}.</span>{task.text}
                    </div>
                  )}
                  {/* --- Updated Icon Container with Slide-in Animation --- */}
                  <div className="absolute top-1/2 right-2 transform -translate-y-1/2 flex items-center gap-2 opacity-0 group-hover:opacity-100 translate-x-4 group-hover:translate-x-0 transition-all duration-300 ease-in-out">
                    {/* --- Edit Button --- */}
                    <button
                      onClick={() => setEditingTask({ id: task.id, text: task.text })}
                      className="text-gray-400 hover:text-primary"
                      aria-label="Edit task"
                    >
                       <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.5L16.732 3.732z" />
                       </svg>
                    </button>
                    {/* --- Delete Button --- */}
                    <button
                      onClick={() => handleDeleteTask(task.id)}
                      className="text-gray-400 hover:text-accent-red"
                      aria-label="Delete task"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm4 0a1 1 0 012 0v6a1 1 0 11-2 0V8z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-8">
        <Link to="/dashboard" className="text-primary hover:underline">← Back to Dashboard</Link>
      </div>
    </div>
  );
}

export default Project;
