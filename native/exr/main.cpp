#include <OpenImageIO/imageio.h>
#include <OpenImageIO/imagecache.h>
#include <OpenColorIO/OpenColorIO.h>
#include <nlohmann/json.hpp>
#include <algorithm>
#include <array>
#include <cmath>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <memory>
#include <set>
#include <sstream>
#include <cctype>
#include <string>
#include <vector>

namespace OCIO = OCIO_NAMESPACE;
namespace fs = std::filesystem;
using json = nlohmann::json;
constexpr int protocolVersion = 1;
constexpr const char* aces13 = "cg-config-v2.2.0_aces-v1.3_ocio-v2.4";
constexpr const char* aces20 = "cg-config-v4.0.0_aces-v2.0_ocio-v2.5";

static std::string lower(std::string s) {
  std::transform(s.begin(), s.end(), s.begin(), [](unsigned char c) { return std::tolower(c); }); return s;
}
static std::string text(const json& j, const char* key, const std::string& fallback = "") {
  return j.contains(key) && j[key].is_string() ? j[key].get<std::string>() : fallback;
}
static void ensure(bool condition, const std::string& message) { if (!condition) throw std::runtime_error(message); }
static void hashBytes(uint64_t& hash, const std::string& value) {
  for (unsigned char c : value) { hash ^= c; hash *= 1099511628211ULL; }
}
static void fingerprintTransform(const OCIO::ConstTransformRcPtr& t, const OCIO::ConstContextRcPtr& context, uint64_t& hash, std::set<std::string>& visited) {
  if (!t) return;
  if (auto group = std::dynamic_pointer_cast<const OCIO::GroupTransform>(t)) {
    for (int n = 0; n < group->getNumTransforms(); ++n) fingerprintTransform(group->getTransform(n), context, hash, visited);
  }
  if (auto file = std::dynamic_pointer_cast<const OCIO::FileTransform>(t)) {
    const std::string resolved = context->resolveFileLocation(file->getSrc());
    if (visited.insert(resolved).second) {
      std::ifstream stream(fs::u8path(resolved), std::ios::binary); ensure(bool(stream), "Missing OCIO LUT: " + resolved);
      std::array<char, 65536> bytes{};
      while (stream) { stream.read(bytes.data(), bytes.size()); hashBytes(hash, std::string(bytes.data(), static_cast<size_t>(stream.gcount()))); }
    }
  }
}
static OCIO::ConstConfigRcPtr loadConfig(const std::string& id) {
  OCIO::ClearAllCaches();
  if (id.rfind("ocio://", 0) == 0) {
    const auto name = id.substr(7); ensure(name == aces13 || name == aces20, "Unsupported built-in OCIO config");
    return OCIO::Config::CreateFromBuiltinConfig(name.c_str());
  }
  ensure(fs::u8path(id).extension() == ".ocio", "Select a .ocio configuration");
  auto config = OCIO::Config::CreateFromFile(id.c_str()); config->validate(); return config;
}
static std::string fingerprint(const OCIO::ConstConfigRcPtr& config) {
  uint64_t hash = 1469598103934665603ULL; std::set<std::string> files;
  std::ostringstream serialized; config->serialize(serialized); hashBytes(hash, serialized.str());
  const auto context = config->getCurrentContext();
  for (int i = 0; i < config->getNumColorSpaces(); i++) {
    auto cs = config->getColorSpace(config->getColorSpaceNameByIndex(i));
    fingerprintTransform(cs->getTransform(OCIO::COLORSPACE_DIR_TO_REFERENCE), context, hash, files);
    fingerprintTransform(cs->getTransform(OCIO::COLORSPACE_DIR_FROM_REFERENCE), context, hash, files);
  }
  for (int i = 0; i < config->getNumLooks(); i++) {
    auto look = config->getLook(config->getLookNameByIndex(i));
    fingerprintTransform(look->getTransform(), context, hash, files); fingerprintTransform(look->getInverseTransform(), context, hash, files);
  }
  for (int i = 0; i < config->getNumViewTransforms(); i++) {
    auto view = config->getViewTransform(config->getViewTransformNameByIndex(i));
    fingerprintTransform(view->getTransform(OCIO::VIEWTRANSFORM_DIR_TO_REFERENCE), context, hash, files);
    fingerprintTransform(view->getTransform(OCIO::VIEWTRANSFORM_DIR_FROM_REFERENCE), context, hash, files);
  }
  for (int i = 0; i < config->getNumNamedTransforms(); i++) {
    auto named = config->getNamedTransform(config->getNamedTransformNameByIndex(i));
    fingerprintTransform(named->getTransform(OCIO::TRANSFORM_DIR_FORWARD), context, hash, files);
    fingerprintTransform(named->getTransform(OCIO::TRANSFORM_DIR_INVERSE), context, hash, files);
  }
  std::ostringstream result; result << std::hex << hash; return result.str();
}
static json configInfo(const std::string& id) {
  const auto cfg = loadConfig(id); json spaces = json::array(), displays = json::array();
  for (int i = 0; i < cfg->getNumColorSpaces(); ++i) spaces.push_back(cfg->getColorSpaceNameByIndex(i));
  for (int i = 0; i < cfg->getNumDisplays(); ++i) {
    const auto display = cfg->getDisplay(i); json views = json::array();
    for (int j = 0; j < cfg->getNumViews(display); ++j) views.push_back(cfg->getView(display, j));
    displays.push_back({ {"name", display}, {"views", views} });
  }
  const auto display = cfg->getDefaultDisplay();
  return {{"spaces",spaces},{"displays",displays},{"defaultDisplay",display},{"defaultView",cfg->getDefaultView(display)},{"fingerprint",fingerprint(cfg)}};
}
static json inspect(const std::string& filename) {
  auto input = OIIO::ImageInput::open(filename); ensure(bool(input), "Cannot read EXR: " + OIIO::geterror());
  ensure(std::string(input->format_name()) == "openexr", "File is not an OpenEXR image");
  json parts = json::array(); OIIO::ImageSpec spec;
  for (int part = 0; input->seek_subimage(part, 0, spec); ++part) {
    ensure(part < 1024 && spec.nchannels < 16384, "EXR header exceeds supported limits");
    json channels = json::array(), attributes = json::object();
    for (int c = 0; c < spec.nchannels; c++) channels.push_back({{"name",spec.channelnames[c]}, {"type",spec.channelformat(c).c_str()}});
    for (const auto& a : spec.extra_attribs) {
      const std::string name = a.name().string();
      if (name.size() <= 512) attributes[name] = spec.metadata_val(a, false).substr(0, 16384);
    }
    parts.push_back({{"index",part},{"name",spec.get_string_attribute("oiio:subimagename", "Part " + std::to_string(part))}, {"deep",spec.deep},
      {"width",spec.full_width},{"height",spec.full_height},{"dataWindow",{spec.x,spec.y,spec.width,spec.height}},
      {"displayWindow",{spec.full_x,spec.full_y,spec.full_width,spec.full_height}}, {"pixelAspectRatio",spec.get_float_attribute("PixelAspectRatio",1.0f)},
      {"compression",spec.get_string_attribute("compression")},{"channels",channels},{"attributes",attributes}});
  }
  input->close(); ensure(!parts.empty(), "EXR has no readable parts"); return {{"parts",parts}};
}
struct Selection { int part = 0; std::vector<std::string> channels; };
static Selection select(const json& request, const json& asset) {
  Selection result;
  int best = -1;
  for (const auto& part : asset["parts"]) {
    if (part["deep"].get<bool>()) continue;
    const int index = part["index"];
    if (request.contains("part") && !request["part"].is_null() && request["part"] != index) continue;
    std::set<std::string> names;
    for (const auto& c : part["channels"]) names.insert(c["name"].get<std::string>());
    for (const auto& name : names) {
      auto dot = name.find_last_of('.'); const auto prefix = dot == std::string::npos ? std::string() : name.substr(0,dot+1);
      if (name.substr(prefix.size()) != "R" || !names.count(prefix+"G") || !names.count(prefix+"B")) continue;
      const auto lowered = lower(prefix + part["name"].get<std::string>());
      const int score = lowered.find("beauty") != std::string::npos || lowered.find("combined") != std::string::npos ? 3 : prefix.empty() ? 2 : 1;
      if (score > best) { best=score; result={index,{prefix+"R",prefix+"G",prefix+"B"}}; if(names.count(prefix+"A")) result.channels.push_back(prefix+"A"); }
    }
    if (best < 0 && !names.empty()) { result={index,{*names.begin()}}; best=0; }
  }
  if (request.contains("part") && !request["part"].is_null()) result.part=request["part"];
  if (request.contains("channels") && !request["channels"].is_null()) result.channels=request["channels"].get<std::vector<std::string>>();
  ensure(!result.channels.empty() && result.channels.size() <= 4, "No supported non-deep EXR channels"); return result;
}
static uint32_t idColor(uint32_t value) {
  if (!value) return 0; value ^= value >> 16; value *= 0x7feb352dU; value ^= value >> 15; value *= 0x846ca68bU; return value ^ (value >> 16);
}
static json render(const json& request) {
  const auto filename=text(request,"filePath"); const auto asset=inspect(filename); const auto selected=select(request,asset);
  auto input = OIIO::ImageInput::open(filename); OIIO::ImageSpec spec;
  ensure(input && input->seek_subimage(selected.part,0,spec), "EXR part does not exist"); input->close();
  ensure(!spec.deep,"Deep EXR is not supported");
  ensure(spec.full_width > 0 && spec.full_height > 0 && spec.width > 0 && spec.height > 0 && spec.nchannels <= 16384, "Invalid EXR dimensions");
  std::vector<int> channelIndices;
  for (const auto& name : selected.channels) { auto it=std::find(spec.channelnames.begin(),spec.channelnames.end(),name); ensure(it!=spec.channelnames.end(),"EXR channel does not exist: "+name); channelIndices.push_back(static_cast<int>(it-spec.channelnames.begin())); }
  std::string mode=text(request,"mode","auto");
  const auto label=lower(selected.channels.front());
  if(mode=="auto") mode=channelIndices.size()==1 ? (label.find("id")!=std::string::npos ? "id" : "scalar") : (label.find("normal")!=std::string::npos || label.find("position")!=std::string::npos ? "normal" : "color");
  if(mode=="color" || mode=="normal") ensure(channelIndices.size()>=3,"Choose at least three channels for this visualization");
  ensure(mode=="color" || mode=="scalar" || mode=="normal" || mode=="id","Invalid visualization mode");
  float aspect=spec.get_float_attribute("PixelAspectRatio",1.0f); if(!std::isfinite(aspect) || aspect<=0 || aspect>100) aspect=1;
  int rx=0,ry=0,rw=spec.full_width,rh=spec.full_height;
  if(request.contains("region") && request["region"].is_object()) {
    auto region=request["region"]; rx=region.at("x"); ry=region.at("y"); rw=region.at("width"); rh=region.at("height");
    ensure(rx>=0 && ry>=0 && rw>0 && rh>0 && int64_t(rx)+rw<=spec.full_width && int64_t(ry)+rh<=spec.full_height,"Invalid EXR inspection region");
  }
  const int maxEdge=std::clamp(request.value("maxEdge",2048),64,4096);
  const double scale=std::min(1.0,std::min(maxEdge/(rw*double(aspect)),maxEdge/double(rh)));
  const int width=std::max(1,int(std::round(rw*aspect*scale))),height=std::max(1,int(std::round(rh*scale)));
  ensure(uint64_t(width)*height*4<=64*1024*1024,"EXR preview exceeds memory budget");
  auto cache=OIIO::ImageCache::create(false);
  cache->attribute("max_memory_MB",128.0f); cache->attribute("max_open_files",4); cache->attribute("autotile",64);
  cache->attribute("threads",2);
  auto read = [&](int x,int y,int c,OIIO::TypeDesc type,void* value) {
    if(x<spec.x || y<spec.y || x>=int64_t(spec.x)+spec.width || y>=int64_t(spec.y)+spec.height) { if(type==OIIO::TypeDesc::UINT) *static_cast<uint32_t*>(value)=0; else *static_cast<float*>(value)=0; return; }
    ensure(cache->get_pixels(OIIO::ustring(filename),selected.part,0,x,x+1,y,y+1,0,1,c,c+1,type,value,OIIO::AutoStride,OIIO::AutoStride,OIIO::AutoStride,c,c+1),"Failed to decode EXR pixels: "+cache->geterror());
  };
  float minValue=0,maxValue=1;
  const auto firstName=lower(selected.channels.front());
  const bool alpha=firstName=="a" || (firstName.size()>2 && firstName.substr(firstName.size()-2)==".a");
  if(mode=="scalar" && !alpha) {
    minValue=std::numeric_limits<float>::infinity(); maxValue=-minValue;
    const int stepX=std::max(1,spec.full_width/256),stepY=std::max(1,spec.full_height/256);
    for(int y=0;y<spec.full_height;y+=stepY) for(int x=0;x<spec.full_width;x+=stepX) {
      float value; read(spec.full_x+x,spec.full_y+y,channelIndices[0],OIIO::TypeDesc::FLOAT,&value);
      if(std::isfinite(value)) { minValue=std::min(minValue,value); maxValue=std::max(maxValue,value); }
    }
    if(!std::isfinite(minValue)) { minValue=0;maxValue=1; } else if(maxValue<=minValue) maxValue=minValue+1;
  }
  if(request.contains("range") && request["range"].is_array()) { minValue=request["range"][0]; maxValue=request["range"][1]; ensure(std::isfinite(minValue)&&std::isfinite(maxValue)&&maxValue>minValue,"Invalid scalar range"); }
  OCIO::ConstCPUProcessorRcPtr inputToLinear,displayProcessor;
  std::string inputName; bool assumed=false;
  const float exposure=request.value("exposure",0.0f); ensure(std::isfinite(exposure)&&std::abs(exposure)<=10,"Invalid exposure");
  if(mode=="color") {
    const auto profile=request.at("profile"); auto cfg=loadConfig(text(profile,"config")); inputName=text(profile,"input","auto");
    if(inputName=="auto") {
      inputName=spec.get_string_attribute("oiio:ColorSpace");
      if(inputName.empty() || !cfg->getColorSpace(inputName.c_str())) {
        size_t rule=0; const auto match=cfg->getColorSpaceFromFilepath(filename.c_str(),rule);
        inputName=match && rule+1<cfg->getFileRules()->getNumEntries() ? match : "";
      }
      if(inputName.empty() || !cfg->getColorSpace(inputName.c_str())) {
        for(const auto& name:{"Linear Rec.709 (sRGB)","Linear Rec.709 (sRGB) - Scene-referred","lin_rec709_scene"}) if(cfg->getColorSpace(name)) { inputName=name;break; }
        assumed=true;
      }
    }
    ensure(!inputName.empty() && cfg->getColorSpace(inputName.c_str()),"Select an input color space; this config has no Linear sRGB fallback");
    const auto linear=cfg->getColorSpace(OCIO::ROLE_SCENE_LINEAR); ensure(bool(linear),"OCIO config has no scene_linear role");
    inputToLinear=cfg->getProcessor(inputName.c_str(),linear->getName())->getDefaultCPUProcessor();
    auto display=text(profile,"display"); if(display.empty()) display=cfg->getDefaultDisplay();
    auto view=text(profile,"view"); if(view.empty()) view=cfg->getDefaultView(display.c_str());
    // Only sRGB presentation is advertised. Reject other output encodings rather
    // than labelling their pixel values as sRGB and silently changing appearance.
    auto displayCS=cfg->getDisplayViewColorSpaceName(display.c_str(),view.c_str());
    std::string outputName=lower(std::string(displayCS ? displayCS : "")+" "+display);
    ensure(outputName.find("srgb")!=std::string::npos,"This display is not supported for SDR sRGB presentation; select an sRGB display");
    displayProcessor=cfg->getProcessor(linear->getName(),display.c_str(),view.c_str(),OCIO::TRANSFORM_DIR_FORWARD)->getDefaultCPUProcessor();
  }
  std::vector<unsigned char> pixels(size_t(width)*height*4);
  for(int y=0;y<height;y++) for(int x=0;x<width;x++) {
    const int sx=spec.full_x+rx+std::min(rw-1,int((x+0.5)*rw/width));
    const int sy=spec.full_y+ry+std::min(rh-1,int((y+0.5)*rh/height));
    float rgba[4]={0,0,0,1}; bool finite=true;
    if(mode=="id" && spec.channelformat(channelIndices[0])==OIIO::TypeDesc::UINT) {
      uint32_t id=0;read(sx,sy,channelIndices[0],OIIO::TypeDesc::UINT,&id); const auto color=idColor(id);
      rgba[0]=float(color&255)/255;rgba[1]=float((color>>8)&255)/255;rgba[2]=float((color>>16)&255)/255;
    } else {
      for(size_t c=0;c<channelIndices.size();c++) { read(sx,sy,channelIndices[c],OIIO::TypeDesc::FLOAT,&rgba[c]);finite=finite&&std::isfinite(rgba[c]); }
      if(mode=="color" && finite) {
        float rgb[3]={rgba[0],rgba[1],rgba[2]};
        if(rgba[3]>0) for(float& value:rgb) value/=rgba[3];
        inputToLinear->applyRGB(rgb); for(float& value:rgb) value*=std::exp2(exposure);displayProcessor->applyRGB(rgb);
        for(int c=0;c<3;c++) rgba[c]=rgb[c]; // PNG stores unassociated alpha.
      } else if(mode=="normal") { for(int c=0;c<3;c++) rgba[c]=(rgba[c]+1)*0.5f;rgba[3]=1; }
      else if(mode=="scalar") { rgba[0]=rgba[1]=rgba[2]=(rgba[0]-minValue)/(maxValue-minValue);rgba[3]=1; }
      else if(mode=="id" && finite) {
        ensure(rgba[0]>=0 && double(rgba[0])<=4294967295.0 && std::floor(rgba[0])==rgba[0],"Non-integer ID channel; use scalar visualization");
        auto color=idColor(static_cast<uint32_t>(rgba[0]));rgba[0]=float(color&255)/255;rgba[1]=float((color>>8)&255)/255;rgba[2]=float((color>>16)&255)/255;rgba[3]=1;
      }
    }
    for(int c=0;c<4;c++) finite=finite&&std::isfinite(rgba[c]);
    if(!finite) { rgba[0]=1;rgba[1]=0;rgba[2]=1;rgba[3]=1; }
    auto offset=(size_t(y)*width+x)*4;
    for(int c=0;c<4;c++) pixels[offset+c]=static_cast<unsigned char>(std::round(std::clamp(rgba[c],0.0f,1.0f)*255));
  }
  const auto outputPath=text(request,"output"); auto output=OIIO::ImageOutput::create("png");ensure(bool(output),"PNG output plugin is unavailable");
  OIIO::ImageSpec outSpec(width,height,4,OIIO::TypeDesc::UINT8); outSpec.attribute("oiio:ColorSpace","sRGB"); outSpec.attribute("oiio:UnassociatedAlpha",1);
  ensure(output->open(outputPath,outSpec),"Cannot open EXR preview destination");
  ensure(output->write_image(OIIO::TypeDesc::UINT8,pixels.data()),"Cannot write EXR preview");ensure(output->close(),"Cannot finish EXR preview");
  OIIO::ImageCache::destroy(cache);
  return {{"width",width},{"height",height},{"input",inputName},{"assumedInput",assumed},{"mode",mode},{"part",selected.part},{"channels",selected.channels},{"range",{minValue,maxValue}}};
}
static json selfTest() {
  const auto config=loadConfig(std::string("ocio://")+aces13);const auto second=loadConfig(std::string("ocio://")+aces20);
  ensure(config->getNumColorSpaces()>0 && second->getNumColorSpaces()>0,"Built-in OCIO config unavailable");
  const auto linear=config->getColorSpace(OCIO::ROLE_SCENE_LINEAR);ensure(bool(linear),"Missing linear color space");
  auto processor=config->getProcessor(linear->getName(),config->getDefaultDisplay(),config->getDefaultView(config->getDefaultDisplay()),OCIO::TRANSFORM_DIR_FORWARD)->getDefaultCPUProcessor();
  float rgb[3]={0.18f,0.5f,2.0f};processor->applyRGB(rgb);for(float c:rgb) ensure(std::isfinite(c),"Invalid OCIO output");
  ensure(bool(OIIO::ImageInput::create("openexr")) && bool(OIIO::ImageOutput::create("png")),"Required codecs unavailable");
  return {{"ok",true},{"protocol",protocolVersion},{"version","1.0.0"}};
}
static json execute(const json& request) {
  const auto op=text(request,"op");
  if(op=="hello") return {{"protocol",protocolVersion},{"version","1.0.0"}};
  if(op=="self-test") return selfTest();
  if(op=="inspect") return inspect(text(request,"filePath"));
  if(op=="config") return configInfo(text(request,"config"));
  if(op=="render") return render(request);
  throw std::runtime_error("Unknown EXR operation");
}
int main(int argc,char** argv) {
  OIIO::attribute("threads",2);
  if(argc==2 && std::string(argv[1])=="--test") {
    try { std::cout<<selfTest().dump()<<std::endl;return 0; } catch(const std::exception& e) { std::cerr<<e.what()<<std::endl;return 1; }
  }
  std::string line;
  while(std::getline(std::cin,line)) {
    if(line.size()>1024*1024) return 2;
    json id=nullptr;
    try { auto request=json::parse(line);id=request.at("id");std::cout<<json({{"id",id},{"success",true},{"value",execute(request)}}).dump()<<std::endl; }
    catch(const std::exception& e) { std::cout<<json({{"id",id},{"success",false},{"error",e.what()}}).dump()<<std::endl; }
  }
  return 0;
}
