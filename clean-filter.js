// Production version of updateFilterOptions without debug logs
const updateFilterOptionsClean = (images: IndexedImage[]) => {
  const allModels = new Set<string>();
  const allLoras = new Set<string>();
  
  images.forEach((image) => {
    // Process models
    let imageModels = image.models;
    if (!Array.isArray(imageModels)) {
      if (imageModels && typeof imageModels === 'object') {
        if (Object.keys(imageModels).every(key => !isNaN(Number(key)))) {
          imageModels = Object.values(imageModels).filter(Boolean);
        } else {
          imageModels = Object.values(imageModels).filter(Boolean);
        }
      } else {
        imageModels = [];
      }
    }

    imageModels.forEach((model) => {
      let modelName = '';
      if (typeof model === 'string') {
        modelName = model.trim();
      } else if (model && typeof model === 'object') {
        modelName = model.name || model.model || model.model_name || 
                   model.base_model || model.mechanism || model.key;
        
        if (typeof modelName !== 'string') {
          modelName = model.key || JSON.stringify(model);
        }
        
        if (modelName && typeof modelName === 'string') {
          modelName = modelName.trim();
          if (modelName.length > 20 && /^[a-f0-9\-]+$/i.test(modelName)) {
            const fallbackName = model.mechanism || model.type || 'Unknown Model';
            modelName = `${fallbackName} (${modelName.substring(0, 8)}...)`;
          }
        }
      }

      if (modelName && modelName.length > 0) {
        allModels.add(modelName);
      }
    });

    // Process loras
    let imageLoras = image.loras;
    if (!Array.isArray(imageLoras)) {
      if (imageLoras && typeof imageLoras === 'object') {
        if (Object.keys(imageLoras).every(key => !isNaN(Number(key)))) {
          imageLoras = Object.values(imageLoras).filter(Boolean);
        } else {
          imageLoras = Object.values(imageLoras).filter(Boolean);
        }
      } else {
        imageLoras = [];
      }
    }

    imageLoras.forEach((lora) => {
      let loraName = '';
      if (typeof lora === 'string') {
        loraName = lora.trim();
      } else if (lora && typeof lora === 'object') {
        loraName = lora.name || lora.model || lora.model_name || 
                  lora.base_model || lora.mechanism || lora.key;
        
        if (typeof loraName !== 'string') {
          loraName = lora.key || JSON.stringify(lora);
        }
        
        if (loraName && typeof loraName === 'string') {
          loraName = loraName.trim();
          if (loraName.length > 20 && /^[a-f0-9\-]+$/i.test(loraName)) {
            const fallbackName = lora.mechanism || lora.type || 'Unknown LoRA';
            loraName = `${fallbackName} (${loraName.substring(0, 8)}...)`;
          }
        }
      }

      if (loraName && loraName.length > 0) {
        allLoras.add(loraName);
      }
    });
  });

  return {
    models: Array.from(allModels).sort(),
    loras: Array.from(allLoras).sort()
  };
};