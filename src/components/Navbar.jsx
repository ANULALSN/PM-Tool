import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { auth } from "../firebase";
import { onAuthStateChanged, signOut } from "firebase/auth";

// A reusable NavLink component for the dynamic underline effect
const NavLink = ({ to, children }) => (
  <Link 
    to={to} 
    className="relative text-white transition-colors hover:text-gray-300 after:absolute after:bottom-[-4px] after:left-0 after:h-[2px] after:w-full after:bg-gradient-to-r from-accent-teal to-secondary-blue after:scale-x-0 after:origin-left after:transition-transform hover:after:scale-x-100"
  >
    {children}
  </Link>
);

// Custom SVG Logo Component
const Logo = () => (
  <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect width="32" height="32" rx="8" fill="#2c3e50"/>
    <rect x="6" y="18" width="8" height="8" rx="2" fill="#1abc9c"/>
    <rect x="18" y="18" width="8" height="8" rx="2" fill="white"/>
    <rect x="6" y="6" width="20" height="8" rx="2" fill="white"/>
  </svg>
);


function Navbar() {
  const [user, setUser] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for authentication state changes
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });

    // Cleanup subscription on component unmount
    return () => unsubscribe();
  }, []);

  const handleLogout = async () => {
    try {
      await signOut(auth);
      navigate("/"); // Redirect to login page after logout
    } catch (error) {
      console.error("Failed to log out", error);
    }
  };

  return (
    <nav className="sticky top-0 z-50 bg-primary/90 backdrop-blur-sm shadow-lg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo/Brand Name */}
          <div className="flex-shrink-0">
            <Link to={user ? "/dashboard" : "/"} className="flex items-center gap-3">
              <Logo />
              <span className="text-2xl font-bold text-white">PMTool</span>
            </Link>
          </div>

          {/* Navigation Links */}
          <div className="hidden md:block">
            <div className="ml-10 flex items-baseline space-x-6">
              {user ? (
                <>
                  <NavLink to="/dashboard">Dashboard</NavLink>
                  <button
                    onClick={handleLogout}
                    className="px-3 py-2 text-sm font-medium text-white bg-accent-red rounded-md hover:bg-opacity-90 transition-colors"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <NavLink to="/">Login</NavLink>
                  <NavLink to="/signup">Sign Up</NavLink>
                </>
              )}
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
}

export default Navbar;
