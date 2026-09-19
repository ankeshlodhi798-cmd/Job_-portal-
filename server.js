const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Stripe = require('stripe');
require('dotenv').config();

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/usajobspro';
const JWT_SECRET = process.env.JWT_SECRET || 'change-this-secret-before-production';

mongoose.connect(MONGODB_URI)
  .then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err.message));

const Job = mongoose.model('Job', new mongoose.Schema({
  title: { type: String, required: true, trim: true }, company: { type: String, required: true, trim: true },
  location: String, salary: String, description: String,
  type: { type: String, default: 'Full-time' }, isPremium: { type: Boolean, default: false },
  postedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, postedAt: { type: Date, default: Date.now }
}));
const User = mongoose.model('User', new mongoose.Schema({
  name: String, email: { type: String, unique: true, lowercase: true, trim: true }, passwordHash: String,
  role: { type: String, enum: ['jobseeker','employer','admin'], default: 'jobseeker' }
}));

function auth(req,res,next){
  const header=req.headers.authorization||''; const token=header.startsWith('Bearer ')?header.slice(7):null;
  if(!token) return res.status(401).json({success:false,message:'Login required'});
  try{req.user=jwt.verify(token,JWT_SECRET);next()}catch(e){return res.status(401).json({success:false,message:'Invalid or expired token'})}
}
function employer(req,res,next){if(req.user.role!=='employer'&&req.user.role!=='admin')return res.status(403).json({success:false,message:'Employer access required'});next()}
function admin(req,res,next){if(req.user.role!=='admin')return res.status(403).json({success:false,message:'Admin access required'});next()}

app.get('/api/health',(req,res)=>res.json({ok:true,service:'USAJobsPro'}));

app.get('/api/jobs',async(req,res)=>{
  try{const {search,location,type}=req.query;const query={};
    if(search)query.$or=[{title:{$regex:search,$options:'i'}},{company:{$regex:search,$options:'i'}},{description:{$regex:search,$options:'i'}}];
    if(location)query.location={$regex:location,$options:'i'}; if(type)query.type={$regex:type,$options:'i'};
    const jobs=await Job.find(query).sort({isPremium:-1,postedAt:-1}).limit(200);res.json(jobs);
  }catch(e){res.status(500).json({success:false,message:'Unable to load jobs'})}
});

app.post('/api/register',async(req,res)=>{
  try{const {name,email,password,role='jobseeker'}=req.body;if(!email||!password||password.length<6)return res.status(400).json({success:false,message:'Email and password (6+ characters) required'});
    const exists=await User.findOne({email});if(exists)return res.status(409).json({success:false,message:'Email already registered'});
    const passwordHash=await bcrypt.hash(password,12);const safeRole=['jobseeker','employer'].includes(role)?role:'jobseeker';
    const user=await User.create({name:name||'User',email,passwordHash,role:safeRole});res.json({success:true,message:'Account created',user:{id:user._id,name:user.name,email:user.email,role:user.role}});
  }catch(e){res.status(500).json({success:false,message:'Registration failed'})}
});

app.post('/api/login',async(req,res)=>{
  try{const {email,password}=req.body;const user=await User.findOne({email});if(!user||!(await bcrypt.compare(password||'',user.passwordHash)))return res.status(401).json({success:false,message:'Invalid email/password'});
    const token=jwt.sign({id:user._id.toString(),email:user.email,role:user.role},JWT_SECRET,{expiresIn:'7d'});
    res.json({success:true,token,user:{id:user._id,name:user.name,email:user.email,role:user.role}});
  }catch(e){res.status(500).json({success:false,message:'Login failed'})}
});

app.post('/api/jobs',auth,employer,async(req,res)=>{try{const {title,company,location,salary,description,type}=req.body;if(!title||!company)return res.status(400).json({success:false,message:'Title and company are required'});const job=await Job.create({title,company,location,salary,description,type,postedBy:req.user.id,isPremium:false});res.status(201).json({success:true,message:'Job posted',job})}catch(e){res.status(500).json({success:false,message:'Job posting failed'})}});

app.post('/api/create-payment',auth,employer,async(req,res)=>{
  if(!process.env.STRIPE_KEY)return res.status(503).json({success:false,message:'Stripe is not configured'});
  try{const stripe=Stripe(process.env.STRIPE_KEY);const base=req.body.returnBaseUrl||'http://localhost:5000';const session=await stripe.checkout.sessions.create({payment_method_types:['card'],line_items:[{price_data:{currency:'usd',product_data:{name:'Premium Job Listing - 1 Day'},unit_amount:2400},quantity:1}],mode:'payment',success_url:`${base}/success.html`,cancel_url:`${base}/cancel.html`,metadata:{userId:req.user.id}});res.json({success:true,url:session.url})}catch(e){res.status(500).json({success:false,message:'Stripe checkout failed'})}
});

app.post('/api/ai-match',auth,async(req,res)=>{const {resumeText='',jobDescription=''}=req.body;if(!resumeText||!jobDescription)return res.status(400).json({success:false,message:'Resume and job description required'});const words=new Set(jobDescription.toLowerCase().match(/[a-z0-9+#.-]{3,}/g)||[]);const resume=resumeText.toLowerCase();let hits=0;words.forEach(w=>{if(resume.includes(w))hits++});const score=words.size?Math.max(1,Math.min(99,Math.round(hits/words.size*100))):1;res.json({success:true,matchScore:score+'%',suggestion:'Add relevant skills and keywords from the job description only when they truthfully match your experience.'})});

app.get('/api/admin/stats',auth,admin,async(req,res)=>{try{const totalJobs=await Job.countDocuments();const premiumJobs=await Job.countDocuments({isPremium:true});const allJobs=await Job.find().sort({postedAt:-1}).limit(10);res.json({totalJobs,premiumJobs,totalEarning:premiumJobs*24,allJobs})}catch(e){res.status(500).json({success:false,message:'Stats unavailable'})}});
app.delete('/api/jobs/:id',auth,admin,async(req,res)=>{try{await Job.findByIdAndDelete(req.params.id);res.json({success:true,message:'Job deleted'})}catch(e){res.status(500).json({success:false,message:'Delete failed'})}});

app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
app.listen(PORT,()=>console.log(`USAJobsPro running on port ${PORT}`));
