import React, { useEffect, useState } from 'react';
import { useTourStore } from '../store/useTourStore';
import { getMockTemplateProject } from '../utils/mockTemplates';
import type { Project } from '../types/tour';
import { PublishModal } from './PublishModal';
import { api } from '../api';
import {
  Plus, Upload, Download, Trash2, ExternalLink, Play, BookOpen,
  Search, Filter, ChevronDown, Sparkles, Gift, MessageCircle,
  FolderPlus, Layers, Globe, Eye, Settings, Music, Map, ShieldCheck,
  CheckCircle2, ArrowRight, Sun, Layout
} from 'lucide-react';

interface DashboardProps {
  onStartWizard: () => void;
  onOpenEditor: () => void;
}

export const Dashboard: React.FC<DashboardProps> = ({ onStartWizard, onOpenEditor }) => {
  const { projects, addProject, deleteProject, setActiveProject, setProjects } = useTourStore();
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [navTab, setNavTab] = useState<'project' | 'media' | 'tools' | 'promotion' | 'enterprise'>('project');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [toolsDropdownOpen, setToolsDropdownOpen] = useState<boolean>(false);
  const [showDemoModal, setShowDemoModal] = useState<boolean>(false);

  /*
   * The server is the source of truth for projects; the store is just a cache.
   * Without this the dashboard only ever showed tours created in the current
   * browser session, so signing in on a new device — or simply reloading —
   * looked like every saved tour had vanished.
   */
  useEffect(() => {
    let cancelled = false;
    void api
      .listProjects()
      .then((saved) => {
        if (cancelled) return;
        setProjects(saved);
        setLoadError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Could not load your tours');
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingProjects(false);
      });
    return () => {
      cancelled = true;
    };
  }, [setProjects]);

  // Load a pre-made template immediately and enter the editor
  const handleLoadTemplate = (category: 'university' | 'mall' | 'museum' | 'hotel' | 'hospital') => {
    const project = getMockTemplateProject(category);
    addProject(project);
    setActiveProject(project);
    onOpenEditor();
  };

  // Select project to edit
  const handleSelectProject = (project: Project) => {
    setActiveProject(project);
    onOpenEditor();
  };

  // JSON Import handler
  const handleImportJSON = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const imported = JSON.parse(event.target?.result as string) as Project;
        if (!imported.id || !imported.name || !imported.scenes) {
          alert('Invalid project configuration file.');
          return;
        }
        imported.id = 'imported_' + Math.random().toString(36).substr(2, 9);
        addProject(imported);
        setActiveProject(imported);
        onOpenEditor();
      } catch (err) {
        alert('Failed to parse project JSON file.');
      }
    };
    reader.readAsText(file);
  };

  // Export JSON handler
  const handleExportJSON = (project: Project) => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(project, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `${project.name.toLowerCase().replace(/\s+/g, '_')}_config.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  // Filter projects
  const filteredProjects = projects.filter(p => {
    const matchesCategory = selectedCategory === 'all' || p.category === selectedCategory;
    const matchesSearch = p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.description?.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-[#f8fafc] text-slate-800 flex flex-col font-sans select-none relative overflow-x-hidden">

      {/* ── 1. VIBRANT LIGHT NAVBAR ────────────────────────────────────────── */}
      <header className="h-14 bg-white/90 border-b border-slate-200/80 px-6 flex items-center justify-between shrink-0 z-50 sticky top-0 backdrop-blur-md shadow-sm">
        {/* Left: Brand & Nav Links */}
        <div className="flex items-center gap-6">
          {/* Logo */}
          <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => setNavTab('project')}>
            <span className="text-2xl font-black tracking-tight text-indigo-600">Zoomio</span>
            <span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
          </div>

          {/* Navigation Links */}
          <nav className="flex items-center gap-1.5 text-xs font-semibold">
            <button
              onClick={() => setNavTab('project')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                navTab === 'project'
                  ? 'bg-indigo-50 text-indigo-600 font-extrabold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Project
            </button>
            <button
              onClick={() => setNavTab('media')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                navTab === 'media'
                  ? 'bg-indigo-50 text-indigo-600 font-extrabold shadow-sm'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Media
            </button>

            {/* Tools Dropdown */}
            <div className="relative">
              <button
                onClick={() => setToolsDropdownOpen(v => !v)}
                className={`px-3.5 py-1.5 rounded-xl transition-all flex items-center gap-1 ${
                  navTab === 'tools' || toolsDropdownOpen
                    ? 'bg-indigo-50 text-indigo-600 font-extrabold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
              >
                <span>Tools</span>
                <ChevronDown size={13} className={`transition-transform ${toolsDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {toolsDropdownOpen && (
                <div className="absolute top-full left-0 mt-2 w-52 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 text-xs">
                  <div className="px-3 py-1 text-[10px] uppercase font-extrabold text-slate-400 tracking-wider">Studio Suite Tools</div>
                  <button onClick={() => { setNavTab('tools'); setToolsDropdownOpen(false); }} className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 font-medium">
                    <Layers size={14} className="text-cyan-500" /> Studio 3D Editor
                  </button>
                  <button onClick={() => { setNavTab('tools'); setToolsDropdownOpen(false); }} className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 font-medium">
                    <Map size={14} className="text-rose-500" /> Floorplan Designer
                  </button>
                  <button onClick={() => { setNavTab('tools'); setToolsDropdownOpen(false); }} className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 font-medium">
                    <Music size={14} className="text-purple-500" /> Sound & Narration
                  </button>
                  <button onClick={() => { setNavTab('tools'); setToolsDropdownOpen(false); }} className="w-full text-left px-3.5 py-2 text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2 font-medium">
                    <Sparkles size={14} className="text-amber-500" /> AI Hotspot Auto-Connect
                  </button>
                </div>
              )}
            </div>

            <button
              onClick={() => setNavTab('promotion')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                navTab === 'promotion'
                  ? 'bg-indigo-50 text-indigo-600 font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Promotion
            </button>
            <button
              onClick={() => setNavTab('enterprise')}
              className={`px-3.5 py-1.5 rounded-xl transition-all ${
                navTab === 'enterprise'
                  ? 'bg-indigo-50 text-indigo-600 font-extrabold'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              Enterprise
            </button>
          </nav>
        </div>

        {/* Right: Status Pill, Language, New Project CTA */}
        <div className="flex items-center gap-3">
          {/* Trial status badge */}
          <div className="hidden md:flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold rounded-full shadow-xs">
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
            <span>7d 6h 45m Trial left</span>
          </div>

          {/* Language Selector */}
          <div className="flex items-center gap-1 px-3 py-1 bg-slate-100 hover:bg-slate-200 rounded-xl text-xs text-slate-700 font-semibold cursor-pointer transition-colors">
            <span>English</span>
            <ChevronDown size={12} className="text-slate-500" />
          </div>

          {/* New Project Vibrant Pink CTA */}
          <button
            onClick={onStartWizard}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 active:scale-95 text-white text-xs font-extrabold rounded-full transition-all shadow-md shadow-rose-500/25"
          >
            <Plus size={15} />
            <span>New Project</span>
          </button>

          {/* Profile Avatar */}
          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 via-rose-500 to-amber-400 p-[2px] cursor-pointer shadow-sm">
            <div className="w-full h-full rounded-full bg-white flex items-center justify-center text-xs font-black text-indigo-600">
              P
            </div>
          </div>
        </div>
      </header>

      {/* ── 2. HERO / WELCOME SECTION (VIBRANT LIGHT THEME) ────────────────────────── */}
      <section className="relative py-14 px-6 flex flex-col items-center justify-center border-b border-slate-200/70 overflow-hidden bg-gradient-to-b from-white via-slate-50/60 to-indigo-50/30"
        style={{
          backgroundImage: 'radial-gradient(circle at 50% 10%, rgba(99, 102, 241, 0.08) 0%, transparent 50%), linear-gradient(0deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99, 102, 241, 0.03) 1px, transparent 1px)',
          backgroundSize: '100% 100%, 36px 36px, 36px 36px'
        }}>
        {/* Main Headline */}
        <h1 className="text-4xl md:text-5xl font-black text-slate-900 text-center tracking-tight mb-3">
          Welcome to <span className="bg-gradient-to-r from-indigo-600 via-rose-500 to-purple-600 bg-clip-text text-transparent">Zoomio</span>
        </h1>
        <p className="text-slate-600 text-sm md:text-base text-center max-w-xl font-medium mb-8">
          Upload 360 photos and build your interactive virtual tour project in minutes.
        </p>

        {/* Primary Magenta/Rose CTA Button */}
        <button
          onClick={onStartWizard}
          className="flex items-center gap-2.5 px-8 py-3.5 bg-gradient-to-r from-rose-500 via-pink-500 to-purple-600 hover:from-rose-600 hover:to-purple-700 active:scale-95 text-white font-extrabold text-sm rounded-full shadow-xl shadow-rose-500/30 transition-all mb-12 hover:shadow-rose-500/45 hover:-translate-y-0.5"
        >
          <Plus size={19} />
          <span>Create Your First Tour</span>
        </button>

        {/* 3 Diagram Workflow Cards (Light Cards) */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl w-full">
          {/* Card 1: Upload */}
          <div
            onClick={onStartWizard}
            className="group bg-white border border-slate-200/90 hover:border-cyan-400 rounded-3xl p-6 flex flex-col items-center text-center cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-cyan-500/10 relative overflow-hidden shadow-sm"
          >
            {/* Screenshot Mockup */}
            <div className="w-full h-36 rounded-2xl bg-slate-100 overflow-hidden relative mb-4 border border-slate-200/60 flex items-center justify-center">
              <img
                src="https://images.unsplash.com/photo-1600585154340-be6161a56a0c?w=500&q=80"
                alt="Upload 360"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent flex items-center justify-center">
                <div className="px-3.5 py-1.5 bg-cyan-500 text-white rounded-xl text-[10px] font-black flex items-center gap-1 shadow-md">
                  <Upload size={12} /> Drag 360 Photos
                </div>
              </div>
            </div>

            {/* Cyan Badge 1 */}
            <div className="w-7 h-7 rounded-full bg-cyan-400 text-slate-950 font-black text-xs flex items-center justify-center mb-3 shadow-sm">
              1
            </div>
            <h3 className="text-base font-extrabold text-slate-900 mb-1 group-hover:text-cyan-600 transition-colors">Upload</h3>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Drag your 360 photos and start building in minutes.
            </p>
          </div>

          {/* Card 2: Edit */}
          <div
            onClick={onOpenEditor}
            className="group bg-white border border-slate-200/90 hover:border-rose-400 rounded-3xl p-6 flex flex-col items-center text-center cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-rose-500/10 relative overflow-hidden shadow-sm"
          >
            {/* Screenshot Mockup */}
            <div className="w-full h-36 rounded-2xl bg-slate-100 overflow-hidden relative mb-4 border border-slate-200/60 flex items-center justify-center">
              <img
                src="https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?w=500&q=80"
                alt="Edit Hotspots"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent flex items-center justify-center">
                <div className="px-3.5 py-1.5 bg-rose-500 text-white rounded-xl text-[10px] font-black flex items-center gap-1 shadow-md">
                  <Layers size={12} /> 3-Column Studio
                </div>
              </div>
            </div>

            {/* Cyan Badge 2 */}
            <div className="w-7 h-7 rounded-full bg-cyan-400 text-slate-950 font-black text-xs flex items-center justify-center mb-3 shadow-sm">
              2
            </div>
            <h3 className="text-base font-extrabold text-slate-900 mb-1 group-hover:text-rose-600 transition-colors">Edit</h3>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Connect scenes with hotspots and customize your experience.
            </p>
          </div>

          {/* Card 3: Publish */}
          <div
            onClick={onOpenEditor}
            className="group bg-white border border-slate-200/90 hover:border-indigo-400 rounded-3xl p-6 flex flex-col items-center text-center cursor-pointer transition-all duration-300 hover:-translate-y-1 hover:shadow-xl hover:shadow-indigo-500/10 relative overflow-hidden shadow-sm"
          >
            {/* Screenshot Mockup */}
            <div className="w-full h-36 rounded-2xl bg-slate-100 overflow-hidden relative mb-4 border border-slate-200/60 flex items-center justify-center">
              <img
                src="https://images.unsplash.com/photo-1600566753376-12c8ab7fb75b?w=500&q=80"
                alt="Publish Tour"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-slate-900/60 via-transparent to-transparent flex items-center justify-center">
                <div className="px-3.5 py-1.5 bg-indigo-600 text-white rounded-xl text-[10px] font-black flex items-center gap-1 shadow-md">
                  <Globe size={12} /> Share & Offline ZIP
                </div>
              </div>
            </div>

            {/* Cyan Badge 3 */}
            <div className="w-7 h-7 rounded-full bg-cyan-400 text-slate-950 font-black text-xs flex items-center justify-center mb-3 shadow-sm">
              3
            </div>
            <h3 className="text-base font-extrabold text-slate-900 mb-1 group-hover:text-indigo-600 transition-colors">Publish</h3>
            <p className="text-xs text-slate-500 font-medium leading-relaxed">
              Publish and share your tour in seconds with your audience.
            </p>
          </div>
        </div>

        {/* Bottom Action Pill Buttons */}
        <div className="flex items-center gap-4 mt-8">
          <button
            onClick={() => setShowDemoModal(true)}
            className="flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm rounded-full text-xs font-bold text-slate-700 transition-all hover:border-rose-300"
          >
            <Play size={14} className="text-rose-500 fill-rose-500" />
            <span>Watch demo tour</span>
          </button>
          <button
            onClick={onOpenEditor}
            className="flex items-center gap-2 px-5 py-2.5 bg-white hover:bg-slate-50 border border-slate-200 shadow-sm rounded-full text-xs font-bold text-slate-700 transition-all hover:border-indigo-300"
          >
            <BookOpen size={14} className="text-indigo-600" />
            <span>Read Tutorial</span>
          </button>
        </div>
      </section>

      {/* ── 3. PROJECTS MANAGEMENT LIST ────────────────────────────────────────── */}
      <main className="max-w-6xl mx-auto px-6 py-10 w-full flex-1">
        {/* Section Header & Controls */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h2 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
              <span>My Projects</span>
              <span className="text-xs font-extrabold px-2.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 border border-indigo-100">
                {projects.length}
              </span>
            </h2>
            <p className="text-xs text-slate-500 font-medium mt-0.5">Manage your virtual tours, templates, and 360 scenes</p>
          </div>

          {/* Search & Import Buttons */}
          <div className="flex items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search projects..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9 pr-4 py-1.5 bg-white border border-slate-200 rounded-xl text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-indigo-500 shadow-xs w-48 transition-all"
              />
            </div>

            {/* Import JSON button */}
            <label className="flex items-center gap-1.5 px-3.5 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 cursor-pointer transition-colors shadow-xs">
              <Upload size={13} className="text-cyan-600" />
              <span>Import JSON</span>
              <input type="file" accept=".json" onChange={handleImportJSON} className="hidden" />
            </label>

            {/* New Tour */}
            <button
              onClick={onStartWizard}
              className="flex items-center gap-1.5 px-4 py-1.5 bg-rose-500 hover:bg-rose-600 text-white text-xs font-extrabold rounded-xl transition-all shadow-sm"
            >
              <Plus size={14} />
              <span>New Tour</span>
            </button>
          </div>
        </div>

        {/* Category Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-2 mb-6 scrollbar-none">
          {['all', 'hotel', 'real-estate', 'university', 'museum', 'mall', 'hospital', 'other'].map(cat => (
            <button
              key={cat}
              onClick={() => setSelectedCategory(cat)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold capitalize whitespace-nowrap transition-all ${
                selectedCategory === cat
                  ? 'bg-indigo-600 text-white font-black shadow-md shadow-indigo-500/20'
                  : 'bg-white text-slate-600 hover:text-slate-900 border border-slate-200 shadow-xs'
              }`}
            >
              {cat === 'all' ? 'All Projects' : cat.replace('-', ' ')}
            </button>
          ))}
        </div>

        {/* Project Cards Grid */}
        {filteredProjects.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-14 bg-white border border-slate-200/80 border-dashed rounded-3xl text-center space-y-4 shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-indigo-50 flex items-center justify-center text-3xl text-indigo-600 shadow-xs">
              🌐
            </div>
            <div className="max-w-sm">
              {/* Distinguish "still loading" and "failed to load" from "you have
                  none" — showing the empty state during a failed fetch makes it
                  look like the user's tours were deleted. */}
              <h3 className="text-base font-bold text-slate-900">
                {loadingProjects
                  ? 'Loading your tours…'
                  : loadError
                    ? 'Could not load your tours'
                    : 'No projects found'}
              </h3>
              <p className="text-slate-500 text-xs font-medium mt-1 leading-relaxed">
                {loadError
                  ? loadError
                  : loadingProjects
                    ? 'Fetching saved projects from the server.'
                    : 'Create a new virtual tour from scratch or load one of our ready-to-use preset templates.'}
              </p>
            </div>
            <div className="flex items-center gap-3 pt-2">
              <button
                onClick={() => handleLoadTemplate('hotel')}
                className="px-4 py-2 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-xl text-xs font-bold text-slate-700"
              >
                Load Hotel Demo
              </button>
              <button
                onClick={onStartWizard}
                className="px-5 py-2 bg-rose-500 hover:bg-rose-600 rounded-xl text-xs font-extrabold text-white shadow-md shadow-rose-500/20"
              >
                Start Upload Wizard
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProjects.map((project) => (
              <div
                key={project.id}
                className="bg-white border border-slate-200 hover:border-indigo-300 rounded-3xl overflow-hidden flex flex-col group transition-all duration-300 hover:shadow-xl shadow-sm"
              >
                {/* Cover Image */}
                <div className="relative h-44 bg-slate-100 flex items-center justify-center overflow-hidden">
                  {project.scenes[0]?.imageUrl || project.coverImage ? (
                    <img
                      src={project.scenes[0]?.imageUrl || project.coverImage}
                      alt={project.name}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="text-center">
                      <span className="text-4xl block mb-1">🌐</span>
                      <span className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">{project.category}</span>
                    </div>
                  )}

                  {/* Scene Count Badge */}
                  <span className="absolute top-3 left-3 px-2.5 py-0.5 text-[10px] font-black rounded-full bg-white/90 border border-slate-200 text-slate-900 shadow-sm backdrop-blur">
                    {project.scenes.length} {project.scenes.length === 1 ? 'Scene' : 'Scenes'}
                  </span>

                  {/* Category Tag */}
                  <span className="absolute top-3 right-3 px-2.5 py-0.5 text-[9px] font-black uppercase tracking-wider rounded-full bg-cyan-400 text-slate-950 shadow-sm">
                    {project.category}
                  </span>
                </div>

                {/* Info & Description */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-base truncate group-hover:text-indigo-600 transition-colors">
                      {project.name}
                    </h3>
                    <p className="text-xs text-slate-500 font-medium line-clamp-2 mt-1 leading-relaxed">
                      {project.description || 'Virtual tour project created with Zoomio Studio.'}
                    </p>
                  </div>

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between border-t border-slate-100 pt-3 mt-4">
                    <button
                      onClick={() => deleteProject(project.id)}
                      className="p-2 hover:bg-rose-50 text-slate-400 hover:text-rose-600 rounded-xl transition-colors"
                      title="Delete project"
                    >
                      <Trash2 size={15} />
                    </button>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleExportJSON(project)}
                        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 border border-slate-200 text-[10px] font-bold text-slate-700 rounded-xl flex items-center gap-1"
                        title="Download JSON config"
                      >
                        <Download size={11} /> JSON
                      </button>
                      <button
                        onClick={() => handleSelectProject(project)}
                        className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-[10px] font-black text-white rounded-xl flex items-center gap-1 shadow-md shadow-indigo-500/20 transition-all"
                      >
                        <span>Edit Studio</span>
                        <ArrowRight size={11} />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ── 4. DEMO TOUR MODAL ────────────────────────────────────────── */}
      {showDemoModal && (
        <div className="fixed inset-0 z-[9999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white border border-slate-200 rounded-3xl max-w-2xl w-full p-6 shadow-2xl relative">
            <h3 className="text-xl font-extrabold text-slate-900 mb-2 flex items-center gap-2">
              <Play className="text-rose-500 fill-rose-500" size={20} /> Take the Zoomio tutorial
            </h3>
            <p className="text-xs text-slate-600 font-medium mb-4 leading-relaxed">
              A guided walkthrough inside the real editor: upload 360° panoramas, place
              navigation and info hotspots, pin scenes to a floor plan, and publish or
              download your tour.
            </p>

            {/*
              Previously this embedded a competitor's YouTube tutorial, which showed a
              different product's interface. The built-in 15-step walkthrough teaches
              this editor instead, and stays correct as the UI changes.
            */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-5 mb-6">
              <ol className="space-y-2 text-xs text-slate-700 font-medium">
                <li><b>1.</b> Load a demo tour or upload your own 2:1 equirectangular photos</li>
                <li><b>2.</b> Pick a tool from the right-hand rail, then click the panorama to place it</li>
                <li><b>3.</b> Link rooms with navigation hotspots, or let AI suggest the connections</li>
                <li><b>4.</b> Hit <b>Share</b> to publish to your own link, or download the ZIP</li>
              </ol>
              <p className="mt-3 text-[11px] text-slate-500">
                The interactive tutorial starts automatically the first time you open the editor,
                and can be reopened any time from the <b>?</b> button.
              </p>
            </div>

            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDemoModal(false)}
                className="px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold rounded-xl"
              >
                Close
              </button>
              <button
                onClick={() => { setShowDemoModal(false); onStartWizard(); }}
                className="px-5 py-2 bg-rose-500 hover:bg-rose-600 text-white text-xs font-black rounded-xl shadow-md shadow-rose-500/20"
              >
                Start Uploading 360 Images
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── 5. FLOATING FOOTER UTILITIES (VIBRANT LIGHT THEME) ────────────────────────── */}
      {/* Bottom Left: Gift Box Icon */}
      <button
        onClick={() => handleLoadTemplate('hotel')}
        className="fixed bottom-5 left-5 z-40 w-11 h-11 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-transform border border-amber-300"
        title="Load Template Presets"
      >
        <Gift size={20} />
      </button>

      {/* Bottom Right: Magenta Chat Bubble Icon */}
      <button
        onClick={onOpenEditor}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-rose-500 text-white flex items-center justify-center shadow-xl hover:scale-110 active:scale-95 transition-transform shadow-rose-500/35 border border-rose-400"
        title="AI Assistant & Editor Support"
      >
        <MessageCircle size={22} />
      </button>

    </div>
  );
};
