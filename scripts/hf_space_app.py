import spaces
import gradio as gr
from llama_cpp import Llama
from huggingface_hub import hf_hub_download

@spaces.GPU
def _gpu_ping():
    return "ok"

# Download Qwen2.5 GGUF model
model_path = hf_hub_download(
    repo_id="Qwen/Qwen2.5-1.5B-Instruct-GGUF",
    filename="qwen2.5-1.5b-instruct-q4_k_m.gguf",
)
llm = Llama(model_path=model_path, n_ctx=4096, n_threads=2, verbose=False)

# CANDIDATE PROFILE (Shoaib Akhtar)
MY_PROFILE = """
CANDIDATE: Shoaib Akhtar
TARGET TITLE: AI Engineer / ML Platform Engineer

VERIFIED SKILLS:
- Generative AI & LLMs: LangChain, LangGraph, CrewAI, LlamaIndex, RAG Pipelines, Prompt Engineering, Fine-Tuning (LoRA/PEFT), Hugging Face, OpenAI API
- Vector Databases: Qdrant, ChromaDB, FAISS
- Core & Backend: Python, SQL, JavaScript, Bash, FastAPI, Flask, Docker, Git, Linux, CI/CD (GitHub Actions), REST APIs
- Machine Learning & Data: PyTorch, Scikit-Learn, Streamlit, NumPy, Pandas, Matplotlib, Feature Engineering, Model Evaluation

VERIFIED PROJECTS:
1. Enterprise Multi-Agent AI Platform
   - Tech: LangGraph, FastAPI, Docker, Qdrant, OpenAI API
   - Summary: Autonomous domain agents with state persistence, supervised routing, and resilient API endpoints.
2. Document Analysis RAG Pipeline
   - Tech: LangChain, ChromaDB, FastAPI, Streamlit, Python
   - Summary: Hybrid dense-sparse retrieval system indexing multi-format enterprise documents with citations and reranking.
3. Autonomous AI Web & LinkedIn Automation Engine
   - Tech: Node.js, Playwright, Chrome DevTools Protocol (CDP), Docker, REST APIs
   - Summary: Real-time autonomous browser automation platform with intelligent form resolution and telemetry tracking.
"""

def analyze(jd):
    prompt = f"""You are an ATS CV Specialist and Technical Career Advisor.
Compare the Job Description (JD) below with the Candidate Profile.

JOB DESCRIPTION:
{jd}

CANDIDATE PROFILE:
{MY_PROFILE}

INSTRUCTIONS:
Provide a strictly structured response with these 4 sections:
1. Top 10 ATS keywords from the JD (bullet list of the 10 most critical hard skills/technologies)
2. Skills from my profile to mention (bullet list of overlapping skills candidate actually possesses)
3. Up to 3 projects to include, 1 line each, using JD keywords (select ONLY from Candidate's 3 verified projects, describe in 1 line incorporating JD keywords)
4. Missing skills (bullet list of required skills in the JD that the candidate DOES NOT have in their profile)

RULES:
- Do NOT invent or fabricate any project that is not in the candidate's profile.
- Do NOT repeat bullet items.
- Be concise and factual.
"""

    out = llm.create_chat_completion(
        messages=[
            {"role": "system", "content": "You are a concise, factual ATS resume expert. Never invent skills or projects."},
            {"role": "user", "content": prompt}
        ],
        max_tokens=900,
        temperature=0.2,
        repeat_penalty=1.15
    )
    return out["choices"][0]["message"]["content"]

demo = gr.Interface(
    fn=analyze,
    inputs=gr.Textbox(lines=12, label="Paste Job Description (JD)", placeholder="Paste the target JD here..."),
    outputs=gr.Markdown(label="ATS Analysis Report"),
    title="AI Job Description & ATS Analyzer",
    description="Extracts top ATS keywords, matches candidate profile, selects verified projects, and identifies skill gaps.",
    api_name="analyze"
)

if __name__ == "__main__":
    demo.launch(ssr_mode=False)
