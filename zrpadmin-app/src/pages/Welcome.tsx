import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import background from '../assets/background.png'
import '../designs/Welcome.css'

export default function Welcome() {
  const [mounted, setMounted] = useState(false)

  // Trigger staggered animations after mount (matches RN Animatable delays)
  useEffect(() => {
    setMounted(true)
  }, [])

  return (
    <div className="welcome-root">
      {/* Background Image with Blur (like blurRadius={10}) */}
      <div 
        className="welcome-bg"
        style={{ backgroundImage: `url(${background})` }}
      />
      
      {/* Dark Overlay: rgba(0,0,0,0.78) */}
      <div className="welcome-overlay">
        
        {/* Title: fadeInDown, 900ms */}
        <h1 className={`welcome-title ${mounted ? 'animate-fade-in-down' : ''}`}>
          Blow Safe
        </h1>

        {/* Subtitle: fadeIn, +300ms delay */}
        <p className={`welcome-subtitle ${mounted ? 'animate-fade-in' : ''}`}>
          Secure smart breathalyser platform for modern traffic enforcement.
        </p>

        {/* Buttons: fadeInUp, +500ms delay */}
        <div className={`welcome-buttons ${mounted ? 'animate-fade-in-up' : ''}`}>
          <Link to="/login" className="welcome-btn">
            Sign In
          </Link>
          <Link to="/signup" className="welcome-btn">
            Sign Up
          </Link>
        </div>

      </div>
    </div>
  )
}