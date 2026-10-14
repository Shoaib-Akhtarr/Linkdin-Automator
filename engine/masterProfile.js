/**
 * Master Authentic Profile of Shoaib Akhtar
 * Contains complete verified career history, projects, skills, education, and credentials.
 */

module.exports = {
  personal: {
    fullName: 'SHOAIB AKHTAR',
    targetTitle: 'AI Engineer',
    location: 'Gujrat, Pakistan',
    phone: '(+92) 3056054842',
    email: 'onlyshoaib158@gmail.com',
    linkedin: 'linkedin.com/in/shoaib-akhtar-133103300',
    github: 'github.com/Shoaib-Akhtarr',
    portfolio: 'https://github.com/Shoaib-Akhtarr'
  },

  summary: 'Analytical and results-driven AI Engineer specializing in Artificial Intelligence, LLMs, and multi-agent systems. Experienced in architecting end-to-end RAG pipelines, deploying production microservices with FastAPI and Docker, fine-tuning ML models, and building autonomous agent workflows. Adept at transforming complex business requirements into high-throughput deployed systems following robust evaluation and clean code standards.',

  skills: {
    languages: ['Python (Expert)', 'SQL', 'C++', 'JavaScript', 'Bash'],
    frameworks: ['LangChain', 'LangGraph', 'CrewAI', 'LlamaIndex', 'FastAPI', 'PyTorch', 'TensorFlow', 'Scikit-Learn', 'Streamlit', 'Flask'],
    generativeAI: ['LLMs', 'RAG Pipelines', 'Vector Databases (Qdrant, ChromaDB, FAISS, Pinecone)', 'Prompt Engineering', 'Model Fine-Tuning', 'Hugging Face', 'Cohere API', 'OpenAI API'],
    mlopsAndCloud: ['Docker', 'Kubernetes', 'CI/CD (GitHub Actions)', 'AWS (EC2, S3)', 'Azure AI', 'MLflow', 'Git', 'Linux'],
    dataScience: ['NumPy', 'Pandas', 'Matplotlib', 'Seaborn', 'Feature Engineering', 'Statistical Analysis', 'Model Evaluation']
  },

  experience: [
    {
      company: 'AppEvolve',
      role: 'AI Intern -> Junior AI Engineer',
      type: 'Full-time, On-site',
      period: 'Jun 2024 – Present',
      location: 'Pakistan',
      bullets: [
        'Developed and deployed production LLM-based applications, multi-agent systems, and agentic workflows using LangChain, LangGraph, CrewAI, and AutoGen in enterprise environments.',
        'Built production RAG pipelines and enterprise document search using vector databases (FAISS, ChromaDB, Qdrant) with hybrid dense-sparse retrieval and source citations.',
        'Trained, fine-tuned, and benchmarked ML/DL models for classification, regression, and recommendation pipelines using PyTorch, Scikit-Learn, and XGBoost.',
        'Designed high-throughput FastAPI and Flask REST APIs and automation pipelines, containerizing services with Docker and automating testing via GitHub Actions CI/CD.'
      ]
    }
  ],

  projects: [
    {
      name: 'Enterprise Multi-Agent AI Platform',
      techStack: ['LangGraph', 'FastAPI', 'Docker', 'Qdrant', 'OpenAI API'],
      bullets: [
        'Designed and deployed an enterprise-grade multi-agent platform orchestrating autonomous domain agents for Operations, Finance, and Customer Support.',
        'Implemented cyclic self-correction state graphs and persistent memory using LangGraph to evaluate tool outputs and maintain conversational coherence.',
        'Built an enterprise RAG knowledge engine supporting PDF, DOCX, and Excel ingestion with dense semantic retrieval via Qdrant vector database.',
        'Containerized microservices using Docker, automated deployment with GitHub Actions, and established comprehensive unit testing and monitoring suites.'
      ]
    },
    {
      name: 'Document Analysis & Hybrid RAG Pipeline',
      techStack: ['LangChain', 'ChromaDB', 'OpenAI API', 'Python', 'FastAPI'],
      bullets: [
        'Engineered an enterprise semantic search workspace deploying context-aware chunking and dense proximity lookups across large internal document repositories.',
        'Parsed over 5,000 unstructured enterprise documents cleanly into semantic matching vectors with 95%+ retrieval accuracy.',
        'Mitigated hallucination risks by integrating hybrid search frameworks combining keyword (BM25) and dense vector search inside ChromaDB.'
      ]
    },
    {
      name: 'AI Agent Frameworks & Recommendation Engine',
      techStack: ['CrewAI', 'LangGraph', 'Scikit-Learn', 'PyTorch', 'Pandas'],
      bullets: [
        'Architected an intelligent multi-agent orchestration grid utilizing interconnected state machines for concurrent analytical execution.',
        'Engineered collaborative filtering and preference data scoring models to surface personalized recommendations.',
        'Designed automated tool-calling workflows and schema verification mechanisms ensuring sub-second inference latency.'
      ]
    }
  ],

  education: [
    {
      degree: 'BS Computer Science',
      institution: 'University of Gujrat (UOG)',
      period: 'Oct 2023 – Present (Expected 2027)',
      location: 'Gujrat, Pakistan',
      highlights: 'Focus on Artificial Intelligence, Machine Learning, Data Structures, and Software Architecture.'
    }
  ],

  certifications: [
    {
      name: 'Generative AI with Large Language Models',
      issuer: 'DeepLearning.AI',
      description: 'Instruction fine-tuning, prompt optimization, RAG, and vector database deployments.'
    },
    {
      name: 'Generative AI for Software Development',
      issuer: 'DeepLearning.AI',
      description: 'Agentic workflows, building LLM applications, and production AI coding assistants.'
    },
    {
      name: 'Machine Learning Engineering for Production (MLOps)',
      issuer: 'DeepLearning.AI',
      description: 'End-to-end MLOps architectures, CI/CD automated deployment, and monitoring.'
    }
  ]
};
